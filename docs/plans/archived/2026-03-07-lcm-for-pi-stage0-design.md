# Stage 0 design note — LCM-style memory for pi (feasibility)

## Goal

Map LCM concepts to pi runtime surfaces and choose an MVP architecture with explicit constraints.

## Evidence reviewed

- pi extension/event APIs and lifecycle:
  - `docs/extensions.md`
  - `dist/core/extensions/types.d.ts`
- pi compaction/session internals:
  - `docs/compaction.md`
  - `docs/session.md`
  - `dist/core/compaction/compaction.d.ts`
  - `dist/core/session-manager.d.ts`
- Reference implementation design:
  - `Martian-Engineering/lossless-claw` README + architecture doc

## Capability map: LCM concept -> pi surface

| LCM need | pi capability | Feasibility |
|---|---|---|
| Persist every message turn | `message_end` / `tool_result` events + `sessionManager.getBranch()` | ✅ extension-only |
| Per-turn context rewrite/assembly | `context` event can replace `messages` | ✅ extension-only |
| Inject extra system guidance | `before_agent_start` can alter system prompt | ✅ extension-only |
| Trigger custom compaction flow | `turn_end` + `ctx.getContextUsage()` + `ctx.compact()` or internal scheduler | ✅ extension-only |
| Replace built-in compaction summary | `session_before_compact` custom `compaction` result | ✅ extension-only |
| Persist extension state in session file | `pi.appendEntry(customType, data)` | ✅ extension-only |
| Durable database storage | Node runtime (use `node:sqlite`), extension-owned files | ✅ extension-only |
| Sub-agent secure expansion grants | no first-class grant layer in extension API | ⚠️ core change for parity |
| Dedicated memory TUI | possible as separate tool, not needed for MVP | ⏸ deferred |

## Constraints matrix

### A) Can be implemented entirely as extension (MVP-compatible)

1. SQLite-backed transcript + summary DAG storage
2. Leaf and condensed summarization passes
3. Context-item ordering and budgeted assembly
4. Fresh-tail protection
5. Feature flag + kill switch
6. Safe fallback to native pi context if extension fails

### B) Requires pi core changes (for full parity/hardening)

1. Native context-engine slot abstraction (OpenClaw-style) instead of event-layer interception
2. First-class delegated expansion auth/grants for sub-agent recall safety
3. Built-in telemetry hooks for compaction diagnostics without extension-side instrumentation hacks

### C) Deferred from MVP feasibility

1. Cross-session memory federation
2. `grep/describe/expand` tool suite
3. Standalone TUI for DAG surgery/repair

## Alternatives considered

### Option 1: Compaction-hook-only (flat summary replacement)
- Mechanism: only use `session_before_compact` to improve summary quality.
- Pros: minimal code.
- Rejected because: cannot preserve DAG structure or robust retrieval path; still vulnerable to information loss over very long sessions.

### Option 2: Full pi core rewrite now
- Mechanism: add true context engine in core immediately.
- Pros: cleanest long-term architecture.
- Rejected because: too large for feasibility phase; blocks quick evidence gathering.

### Option 3 (chosen): Extension-level LCM engine with context interception
- Mechanism: extension-owned SQLite DAG + `context` event assembly override + optional compaction triggers.
- Pros: fastest path to validate outcomes in real pi workflows; zero external services; fully toggleable.
- Trade-off: some limits vs deep core integration.

## Chosen hard-cut MVP architecture

### Components

1. `lcm-extension.ts` (entry)
2. `lcm/db.ts` (SQLite connection + migrations)
3. `lcm/store.ts` (messages/summaries/context_items CRUD)
4. `lcm/compaction.ts` (leaf + condensed passes)
5. `lcm/assemble.ts` (budgeted context assembly)
6. `lcm/config.ts` (flags, thresholds, model settings)

### Runtime flow (single-session)

1. On session start/switch: resolve conversation key from session file path + cwd.
2. On message lifecycle events: persist canonical message rows.
3. On turn end: evaluate thresholds, run incremental compaction passes if needed.
4. On `context` event: assemble context from DAG summaries + fresh raw tail, return `{ messages }`.
5. On any failure: return nothing from handler -> pi native context path continues.

### Hard cuts (explicit)

- No backward-compat shims for old storage formats.
- No OpenClaw tool parity in MVP.
- No cross-session retrieval in MVP.
- No separate binary/TUI in MVP.

## Config/toggle shape (proposed)

- Global/project settings block (or extension-local file):
  - `enabled: boolean`
  - `dbPath: string`
  - `contextThreshold: number`
  - `freshTailCount: number`
  - `leafChunkTokens: number`
  - `incrementalMaxDepth: number`

Default: disabled until explicitly enabled.

## Stage 0 decision

Proceed with **Option 3** for Stage 1 prototype work.

Success signal for next gate: we can reliably assemble model context from extension-owned DAG state while preserving message/tool integrity and optional fail-open behavior.
