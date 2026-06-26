# Model Preference Config — Implementation Plan

**Feature:** Read model preference config from `settings.json` and override agent frontmatter models at spawn time.

---

## Context Summary

- **Current resolution** (`index.ts:942`): `const effectiveModel = params.model ?? agentDefs?.model;`
- **No config reading exists** — extension never reads `settings.json`
- **ExtensionAPI has no `getExtensionConfig()`** — must read `settings.json` directly via `fs.readFileSync`
- **Settings path**: `~/.pi/settings.json` (use `homedir()` + join, same pattern as `getAgentConfigDir()`)
- **Injection point**: `launchSubagent()` — new `resolveModelPreference()` step between `loadAgentDefaults()` and `effectiveModel` assignment

---

## Target Config Format

```json
{
  "extensions": {
    "subagent": {
      "defaultModel": "llama-swap/orchestrator",
      "modelTiers": {
        "cheap":    "llama-swap/gemma-4-E4B",
        "balanced": "llama-swap/qwen3.6-27b-coder",
        "max":      "llama-swap/qwen3-80b-thinking-128k"
      },
      "agentTiers": {
        "scout":       "cheap",
        "worker":      "balanced",
        "planner":     "max",
        "reviewer":    "max",
        "visual-tester": "balanced"
      }
    }
  }
}
```

---

## Plan

### Step 1 — Add `loadModelPreferenceConfig()` function

**File:** `pi-extension/subagents/index.ts`
**Location:** After `loadStatusConfig` import block (~line 50), before `getAgentConfigDir()`

**Add:**
```typescript
// ── Model preference config ──

interface ModelPreferenceConfig {
  defaultModel?: string;
  modelTiers?: Record<string, string>;  // tier name -> model string
  agentTiers?: Record<string, string>;  // agent name -> tier name
}

function getModelPreferenceConfig(): ModelPreferenceConfig | null {
  const settingsPath = join(homedir(), ".pi", "settings.json");
  if (!existsSync(settingsPath)) return null;
  
  try {
    const raw = readFileSync(settingsPath, "utf8");
    const settings = JSON.parse(raw) as Record<string, unknown>;
    const extensions = settings.extensions as Record<string, unknown> | undefined;
    if (!extensions || typeof extensions !== "object") return null;
    const subagent = extensions.subagent as Record<string, unknown> | undefined;
    if (!subagent || typeof subagent !== "object") return null;
    
    return {
      defaultModel: typeof subagent.defaultModel === "string" ? subagent.defaultModel : undefined,
      modelTiers: typeof subagent.modelTiers === "object" && subagent.modelTiers != null
        ? subagent.modelTiers as Record<string, string>
        : undefined,
      agentTiers: typeof subagent.agentTiers === "object" && subagent.agentTiers != null
        ? subagent.agentTiers as Record<string, string>
        : undefined,
    };
  } catch {
    // Malformed settings.json — silently fall back to no config
    return null;
  }
}
```

**Rationale:** 
- Reads `~/.pi/settings.json` directly (same pattern as `getAgentConfigDir()`)
- Returns `null` when config is missing or malformed — never throws
- Type-safe extraction with `typeof` guards
- Cached at module level (see Step 2)

**Edge cases handled:**
- Missing `settings.json` → `null`
- Missing `extensions` key → `null`
- Missing `extensions.subagent` key → `null`
- Malformed JSON → `null` (caught by try/catch)
- Wrong types for nested keys → `undefined` (not included in return)

---

### Step 2 — Add module-level config cache

**File:** `pi-extension/subagents/index.ts`
**Location:** After `statusConfig` module variable (~line 418)

**Add:**
```typescript
const statusConfig = loadStatusConfig();

// Cached model preference config — read once at module load, refreshed on /reload
const modelPrefConfig = getModelPreferenceConfig();
```

**Rationale:** 
- Single read at module load time (same pattern as `statusConfig`)
- Automatically refreshes on `/reload` (module re-import)
- No performance cost per spawn

---

### Step 3 — Add `resolveModelPreference()` function

**File:** `pi-extension/subagents/index.ts`
**Location:** After `getModelPreferenceConfig()` function

**Add:**
```typescript
/**
 * Resolve the effective model for a subagent spawn, applying config overrides.
 * 
 * Priority (highest to lowest):
 * 1. params.model (explicit tool call override)
 * 2. Config agentTiers + modelTiers lookup (agent name -> tier -> model)
 * 3. agentDefs?.model (frontmatter default)
 * 4. Config defaultModel (global fallback)
 */
function resolveModelPreference(
  paramsModel: string | undefined,
  agentDefsModel: string | undefined,
  agentName: string | undefined,
): string | undefined {
  // Explicit override from tool call — always wins
  if (paramsModel) return paramsModel;
  
  const config = modelPrefConfig;
  if (!config) return agentDefsModel;
  
  // Tier-based override: agent name -> tier -> model
  if (agentName && config.agentTiers) {
    const tierName = config.agentTiers[agentName];
    if (tierName && config.modelTiers?.[tierName]) {
      return config.modelTiers[tierName];
    }
  }
  
  // Frontmatter model
  if (agentDefsModel) return agentDefsModel;
  
  // Global default fallback
  return config.defaultModel;
}
```

**Rationale:**
- Clean priority chain: explicit > tier override > frontmatter > global default
- Returns `undefined` when no model found (preserves existing "no model" behavior)
- Never throws — all lookups are guarded with optional chaining

**Edge cases:**
- `agentName` is `undefined` (no agent specified) → skips tier lookup, falls through
- Tier name in `agentTiers` doesn't exist in `modelTiers` → falls through to frontmatter
- All config values missing → returns `agentDefsModel` (unchanged behavior)

---

### Step 4 — Inject into `launchSubagent()`

**File:** `pi-extension/subagents/index.ts`
**Line:** ~942 (replace the existing `effectiveModel` assignment)

**Change:**
```typescript
// BEFORE:
const effectiveModel = params.model ?? agentDefs?.model;

// AFTER:
const effectiveModel = resolveModelPreference(
  params.model,
  agentDefs?.model,
  params.agent,
);
```

**Rationale:** 
- Single-line replacement — minimal diff
- `resolveModelPreference` returns `undefined` when no override applies, which is identical to the original `??` behavior when config is absent
- No change to downstream code — `effectiveModel` type is unchanged (`string | undefined`)

---

### Step 5 — Export for testing

**File:** `pi-extension/subagents/index.ts`
**Location:** `__test__` export object (~line 895)

**Add to exports:**
```typescript
export const __test__ = {
  // ... existing exports ...
  getModelPreferenceConfig,
  resolveModelPreference,
};
```

---

### Step 6 — Add unit tests

**File:** `test/test.ts`
**Location:** New `describe` block at end of file

**Test cases:**

```typescript
describe("model preference config", () => {
  describe("resolveModelPreference", () => {
    it("returns params.model when explicitly set", () => {
      // With no config
      const result = subagentsModule.__test__.resolveModelPreference(
        "explicit-model", undefined, "coder"
      );
      assert.equal(result, "explicit-model");
    });
    
    it("falls back to agentDefs model when no config", () => {
      const result = subagentsModule.__test__.resolveModelPreference(
        undefined, "frontmatter-model", "coder"
      );
      assert.equal(result, "frontmatter-model");
    });
    
    it("returns undefined when both inputs are undefined", () => {
      const result = subagentsModule.__test__.resolveModelPreference(
        undefined, undefined, undefined
      );
      assert.equal(result, undefined);
    });
    
    it("params.model wins over tier override", () => {
      const result = subagentsModule.__test__.resolveModelPreference(
        "explicit-model", "frontmatter-model", "coder"
      );
      assert.equal(result, "explicit-model");
    });
    
    it("undefined agentName skips tier lookup", () => {
      const result = subagentsModule.__test__.resolveModelPreference(
        undefined, "frontmatter-model", undefined
      );
      assert.equal(result, "frontmatter-model");
    });
  });
  
  describe("getModelPreferenceConfig", () => {
    it("returns null when settings.json doesn't exist", () => {
      // This tests the existsSync guard — settings.json at ~/.pi/ should exist
      // but the extensions.subagent key likely won't, so it returns null
      const result = subagentsModule.__test__.getModelPreferenceConfig();
      // Will be null if extensions.subagent is not configured
      // (which is the expected state for most users)
      assert.ok(result === null || typeof result === "object");
    });
  });
});
```

**Rationale:**
- Tests the resolution logic in isolation
- Covers all priority branches
- Tests edge cases (undefined inputs, missing config)
- Does NOT require mocking settings.json — tests work with current state

---

### Step 7 — Add config documentation

**File:** `README.md` (or new `docs/model-preferences.md`)
**Location:** New section after existing config documentation

**Content:**
```markdown
## Model Preferences

Configure model overrides for subagent spawns in `~/.pi/settings.json`:

```json
{
  "extensions": {
    "subagent": {
      "defaultModel": "llama-swap/orchestrator",
      "modelTiers": {
        "cheap":    "llama-swap/cheap-model",
        "balanced": "llama-swap/balanced-model",
        "max":      "llama-swap/max-model"
      },
      "agentTiers": {
        "coder":    "balanced",
        "planner":  "max"
      }
    }
  }
}
```

**Priority:** `params.model` > `agentTiers` lookup > agent frontmatter `model` > `defaultModel`

- `defaultModel`: Global fallback when no other model is specified
- `modelTiers`: Named tiers mapping to model strings
- `agentTiers`: Maps agent names to tier names for automatic model assignment
```

---

## Verification Checklist

- [ ] Config reading returns `null` when `settings.json` has no `extensions.subagent` section
- [ ] Config reading returns `null` when `settings.json` is malformed JSON
- [ ] `resolveModelPreference` returns `params.model` when set (explicit override always wins)
- [ ] `resolveModelPreference` returns tier model when agent matches `agentTiers`
- [ ] `resolveModelPreference` returns `agentDefs.model` when no tier match
- [ ] `resolveModelPreference` returns `defaultModel` when no agent and no frontmatter model
- [ ] `resolveModelPreference` returns `undefined` when all sources empty
- [ ] Existing spawns without config work identically (no regression)
- [ ] `/reload` refreshes config (module re-import pattern)
- [ ] Unit tests pass

---

## Rollback

- Remove the 3 new functions (`getModelPreferenceConfig`, `resolveModelPreference`, module-level `modelPrefConfig`)
- Revert line ~942 to: `const effectiveModel = params.model ?? agentDefs?.model;`
- Remove `__test__` exports
- Remove test cases

**No data files are modified** — `settings.json` is read-only. No destructive operations.

---

## Risks & Dependencies

1. **Settings.json path assumption:** Uses `~/.pi/settings.json` via `homedir()`. If `PI_CODING_AGENT_DIR` changes the base dir, this won't follow. **Mitigation:** Same pattern as existing `getAgentConfigDir()` — if pi changes this pattern, both break the same way.

2. **JSON parse failure:** Silently returns `null` — no error surfaced to user. **Acceptable** — config is optional, and malformed config shouldn't break spawns.

3. **Config cache stale after manual settings.json edit:** Requires `/reload` to pick up changes. **Acceptable** — matches existing `statusConfig` behavior. Could add a file timestamp check later if needed.

4. **No per-project config:** Only reads global `~/.pi/settings.json`, not `.pi/settings.json`. **By design** — model preferences are user-level, not project-level. If needed later, add project-local override following the same pattern as `loadAgentDefaults` (project → global → bundled).

---

## Files Changed

| File | Change | Lines |
|------|--------|-------|
| `pi-extension/subagents/index.ts` | Add `getModelPreferenceConfig()`, `resolveModelPreference()`, `modelPrefConfig` cache, inject into `launchSubagent()`, add `__test__` exports | ~80 added |
| `test/test.ts` | Add "model preference config" describe block with unit tests | ~50 added |
| `README.md` | Add Model Preferences documentation section | ~25 added |
