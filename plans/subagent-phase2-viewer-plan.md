# Subagent Phase 2 Plan — Viewer Integration (Lean)

## Status
Planned after Phase 1 PR #1 (`10541ae` on `origin/main`).

## Goal
Add optional iTerm2 viewer integration for one-shot subagent execution, with zero impact on runtime correctness.

---

## 1) Scope

### In scope
- One-shot modes only (`single`, `parallel`, `chain`).
- Viewer layer contracts and iTerm2 implementation.
- Tool-path hook to optionally open viewer when spawning.
- Non-blocking failure behavior (viewer cannot fail execution).
- README update for settings + behavior.

### Out of scope
- Any remaining tmux runtime hardening gates from Phase 1.
- Pool/orchestrator viewer integration.
- New long-lived `send()` semantics.
- Multi-platform viewers (Terminal.app, Alacritty, etc.).

---

## 2) Implementation slice (single PR)

## PR: `feat: add optional iTerm2 viewer integration for one-shot runs`

### Goals
1. Add viewer interfaces and factory.
2. Add iTerm2 adapter (`viewerMode: "iterm2"`).
3. Hook viewer open into one-shot path with one-attempt guard.
4. Preserve existing execution behavior and rendering.

### Target files
- `extensions/pi-subagent/src/viewer/types.ts` (new)
- `extensions/pi-subagent/src/viewer/factory.ts` (new)
- `extensions/pi-subagent/src/viewer/iterm2.ts` (new)
- `extensions/pi-subagent/src/tool.ts` (integration)
- `extensions/pi-subagent/src/runtime/types.ts` (optional viewer-target capability)
- `extensions/pi-subagent/README.md` (settings/behavior docs)

### Acceptance criteria
- Typecheck passes.
- With defaults (`viewerMode: "none"`), behavior is unchanged.
- With viewer enabled, one-shot runs still succeed even if iTerm automation fails.
- Parallel mode does not open a viewer per task (one attempt per tool invocation).
- Pool/orchestrator behavior remains unchanged.

### Validation steps
1. `cd extensions/pi-subagent && npm run typecheck`
2. Smoke (viewer off): single, parallel, chain, pool spawn/send/list/kill.
3. Smoke (viewer on): single + parallel.
4. Failure check: simulate iTerm failure (not running / permission denied) and confirm run success.

---

## 3) Viewer interface design

```ts
// src/viewer/types.ts
export type ViewerMode = "none" | "iterm2";

export interface RuntimeViewerTarget {
  kind: "tmux";
  sessionName: string;
  target?: string; // e.g. session or session:window
}

export interface ViewerAdapter {
  readonly mode: ViewerMode;
  isAvailable(): Promise<{ ok: true } | { ok: false; reason: string }>;
  attach(target: RuntimeViewerTarget): Promise<{ viewerRef?: string }>;
}
```

Runtime hook (optional capability):

```ts
// src/runtime/types.ts
getViewerTarget?(): Promise<RuntimeViewerTarget | null>
```

Integration point in `tool.ts`:
- Create adapter once per tool call.
- `maybeOpenViewerOnce()` guard.
- Attempt open only when settings allow it.
- Catch/log and continue immediately.

---

## 4) Failure semantics (must hold)

1. Viewer is best-effort only.
2. Viewer errors must not throw into execution path.
3. Runtime result is authoritative.
4. Viewer open must be timeout-bounded.
5. Failures are logged; user-visible run output is unchanged.

---

## 5) Settings behavior

- `viewerMode: "none"` → skip viewer always.
- `viewerMode: "iterm2"` + `openViewerOnSpawn: false` → no auto-open.
- `viewerMode: "iterm2"` + `openViewerOnSpawn: true`:
  - If runtime can provide viewer target: try attach once.
  - If target unavailable (e.g., process runtime fallback): log + skip.
- Invalid settings already fall back safely via `resolveSettings()`.

---

## 6) Risk register (minimal)

- **iTerm automation brittle/permission-gated**
  - Mitigation: best-effort only, never blocks execution.
- **Parallel pane spam**
  - Mitigation: one-attempt-per-tool-call guard.
- **Non-macOS portability**
  - Mitigation: `isAvailable()` returns unsupported; no-op.
- **User confusion when nothing opens**
  - Mitigation: clear README + structured logs.

---

## 7) Rollout strategy (single-user)

- Keep defaults unchanged (`viewerMode: "none"`, `openViewerOnSpawn: false`).
- Enable locally when desired.
- If behavior is annoying, disable with one setting change:
  - `viewerMode: "none"` or `openViewerOnSpawn: false`.

No staged rollout needed.

---

## Definition of done

- PR merged with files above.
- Typecheck + smoke checks pass.
- README updated with:
  - how to enable viewer,
  - non-blocking semantics,
  - quick disable path.

---

## Implementation checklist

### A) Viewer layer scaffolding
- [ ] Create `extensions/pi-subagent/src/viewer/types.ts`
- [ ] Create `extensions/pi-subagent/src/viewer/factory.ts`
- [ ] Add a no-op adapter for `viewerMode: "none"`
- [ ] Add/confirm TypeScript exports/imports compile cleanly

### B) iTerm2 adapter
- [ ] Create `extensions/pi-subagent/src/viewer/iterm2.ts`
- [ ] Implement `isAvailable()` checks (platform/app/automation prerequisites)
- [ ] Implement `attach(target)` with timeout-bounded execution
- [ ] Ensure all failures return structured errors (no uncaught throw into caller)

### C) Runtime/tool integration
- [ ] Add optional runtime viewer-target capability (`getViewerTarget?`) if needed
- [ ] In `tool.ts`, initialize viewer once per tool invocation
- [ ] Implement `maybeOpenViewerOnce()` guard (single/parallel/chain safe)
- [ ] Gate open behavior with settings (`viewerMode`, `openViewerOnSpawn`)
- [ ] Log viewer failures and continue execution

### D) Docs
- [ ] Update `extensions/pi-subagent/README.md` with enable/disable examples
- [ ] Document non-blocking semantics clearly
- [ ] Add quick troubleshooting note for iTerm permissions/failures

### E) Validation
- [ ] `cd extensions/pi-subagent && npm run typecheck`
- [ ] Smoke (viewer off): single / parallel / chain / pool spawn-send-list-kill
- [ ] Smoke (viewer on): single + parallel
- [ ] Failure simulation: iTerm unavailable/denied, confirm run still succeeds

### F) Ship
- [ ] Open PR with Conventional Commit title
- [ ] Merge after checks pass
- [ ] Optional local opt-in via settings for day-to-day use
