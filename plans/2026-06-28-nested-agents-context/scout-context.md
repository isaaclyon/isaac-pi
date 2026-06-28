# Scout findings: nested AGENTS/CLAUDE context extension

## Where to place it
- Best fit is a new vendored extension under `agent/extensions/` (same pattern as `model-aware-compaction`, `productionize`, `ask-user-question`). Those extensions register from a single `index.ts`/entry file and can hook session/tool/input events.
- If this should ship as a package, mirror `packages/pi-interactive-subagents` with a `pi-extension/...` directory plus `package.json` `pi.extensions` wiring.

## Relevant patterns
- `usage-analytics/extensions/usage-tracker.ts` is the closest event-driven provenance pattern: it caches tool metadata on `session_start`, listens to `input`, `tool_execution_start`, `tool_execution_end`, and clears state on `session_shutdown`.
  - `session_start` refreshes cached tools/commands (`usage-tracker.ts:169-172`)
  - `input` observes raw user text (`174-205`)
  - `tool_execution_start/end` track path-like args and emit records (`207-260`)
- `productionize/repair-guard.ts` shows typed path guarding for `read/edit/write/bash` and path confinement by mutating tool-call inputs before execution (`12-44`, `62-100`).
- `model-aware-compaction/index.ts` shows lifecycle reset points for session transitions and reload-ish state:
  - reset on `session_start`, `session_tree`, `session_before_compact`, `session_compact` (`215-245`)
  - `agent_end` is the post-turn trigger for native compaction nudging (`265-330`)
- `pi-interactive-subagents` shows module-reload cleanup via global abort/timer reset and `session_shutdown` cleanup (`index.ts:69-98`, `2209-2274`).

## Likely event/API shape for this feature
- Observe tool calls via `tool_execution_start` / `tool_execution_end` rather than raw `input`.
- Track only typed filesystem tools with path-like fields: `read`, `write`, `edit`, `ls/list`, `grep/search/find`, and any future tools whose args expose a path field.
- Do **not** inspect/bash-parse `input` for shell commands; repo patterns treat `input` separately from tool execution.
- Use `session_start` to clear per-session caches, and likely `session_tree`/`session_before_compact`/`session_compact` to clear any “already injected” state when the effective prompt can change.

## Context injection implications
- There is already a strong precedent that `ctx.getSystemPrompt()` includes AGENTS/CLAUDE-derived context but not in `SessionContext.messages` (`model-aware-compaction.ts:100-105`). This suggests nested file context should be injected into the system prompt path, not as ordinary conversation turns.
- The planner should assume a single effective prompt area (system prompt / role instructions) and merge discovered nested context there once per session/compaction window.
- Because tool calls are event-driven, injection probably needs a cache keyed by discovered directory ancestry + session/compaction epoch, not per tool call.

## Reset / once-per-window behavior
- Session-start and compaction/navigation events are the safe reset points.
- `pi-interactive-subagents` explicitly treats `/reload` as a module reload that must clear stale timers/aborts; a similar extension should be resilient to module re-imports and avoid duplicate injections across reload.
- Compaction resets are important because a fresh effective prompt can be rebuilt; if context is injected into system prompt state, it should be re-derived after compaction rather than blindly re-used forever.

## Edge cases to plan for
- Nested folder access via relative paths, `@`-prefixed paths, and `~/...` should be normalized like `usage-tracker.ts:38-55`.
- `realpath`/symlink resolution matters: the analytics extension normalizes to `realpathSync.native` when possible (`44-55`); this is a good model for deduping nested AGENTS/CLAUDE discovery.
- Multiple discovered instruction files in ancestry need deterministic order (likely root → deepest, or deepest overrides root). The repo currently documents only one-level agent discovery precedence, not nested prompt merging.
- Need dedupe so one discovered file is injected once per session/window even if multiple typed tool calls hit the same subtree.
- Need a policy for missing/malformed files and for folders without any AGENTS/CLAUDE file: no-op, no error.
- Need to be careful not to make hidden prompt injection visible as extra user content or transcript entries unless intentionally logged.

## Tests/scripts/docs to mirror
- No dedicated tests for a nested-context feature exist yet in the inspected code. Closest test styles:
  - `packages/usage-analytics/tests/extension.test.mjs` (mock `pi`, call handlers directly)
  - `packages/pi-interactive-subagents/test/test.ts` (event/lifecycle unit tests, including shutdown/reload cases)
  - integration tests in `packages/pi-interactive-subagents/test/integration/` for end-to-end session behavior
- Package wiring to imitate: `packages/pi-interactive-subagents/package.json` uses `"pi": { "extensions": ["./pi-extension/subagents/index.ts"] }`.
- If the feature lands, it likely needs unit tests for ancestry discovery/deduping plus event-hook tests for reset on `session_start`/compaction.
