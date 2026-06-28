# Todos: nested-agents-context

## TODO-001 — Pure path/context discovery helpers
- [x] [nested-agents-context] Add `agent/extensions/nested-agents-context/context.ts` with tested helpers for path extraction, normalization, cwd-bounded instruction discovery, and prompt-block formatting.

References:
- Plan: `plans/2026-06-28-nested-agents-context/plan.md`
- Existing normalization pattern: `agent/packages/usage-analytics/extensions/usage-tracker.ts:38-55`
- Pi context discovery/formatting: `dist/core/resource-loader.js:29-74`, `dist/core/system-prompt.js:102-109`

Acceptance:
- Covers `read`/`write`/`edit`/`ls`/`list`/`grep`/`search`/`find` args plus conservative future path-like fields.
- Explicitly ignores `bash.command`, `pattern`, `glob`, and `content`.
- Discovery is deterministic, deduped by realpath, shallow-to-deep, and bounded to `ctx.cwd`.

## TODO-002 — Extension event wiring and prompt injection
- [x] [nested-agents-context] Add `agent/extensions/nested-agents-context/index.ts` to observe `tool_execution_start`, load newly discovered instruction files once per window, inject them in `before_agent_start`, and reset on session/tree/compaction/shutdown.

References:
- Plan: `plans/2026-06-28-nested-agents-context/plan.md`
- Tool-event pattern: `agent/packages/usage-analytics/extensions/usage-tracker.ts:207-260`
- Prompt modification API: `docs/extensions.md:497-532`
- Reset pattern: `agent/extensions/model-aware-compaction/index.ts:215-245`

Acceptance:
- No bash parsing and no transcript/custom-message injection.
- Nested context is appended with `<project_context>` / `<project_instructions path="...">` tags.
- Existing startup context files from `event.systemPromptOptions.contextFiles` are not duplicated.
- Loaded nested files reset on `session_start`, `session_tree`, `session_before_compact`, `session_compact`, and `session_shutdown`.

## TODO-003 — Tests and maintainer note
- [x] [nested-agents-context] Add focused unit/event tests and a short README or header comment documenting behavior, verification, and the same-in-flight-turn limitation.

References:
- Plan: `plans/2026-06-28-nested-agents-context/plan.md`
- Test style: `agent/packages/usage-analytics/tests/extension.test.mjs`, `agent/extensions/productionize/*.test.ts`

Acceptance:
- `node --test agent/extensions/nested-agents-context/*.test.ts` passes.
- Tests prove dedupe, reset behavior, base-context filtering, and ignored bash command strings.
- Documentation states that provider-independent injection applies on the next `before_agent_start`; same-turn continuation requires Pi core support rather than provider payload parsing.
