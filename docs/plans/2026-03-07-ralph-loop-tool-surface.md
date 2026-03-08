Add a structured `ralph_loop` tool (`start|stop|status|runs`) and route slash commands through the same shared handlers so Pi can parse natural language and call Ralph reliably.

## User context

- You want natural-language-first usage where Pi parses intent and calls an extension tool instead of requiring manual JSON command payloads each run.
- You explicitly confirmed: shared command+tool execution path is preferred.
- Current Ralph extension has mature command UX and validation, but no dedicated `ralph_loop` tool surface yet.

## Key acceptance criteria

- [x] `ralph_loop` tool is registered from `agent/extensions/ralph-loop/index.ts`.
- [x] Tool supports canonical actions: `start`, `stop`, `status`, `runs`.
- [x] Tool `start` accepts structured optional overrides (task, maxLoops, budget, success, runner fields).
- [x] Slash commands (`/ralph-start`, `/ralph-stop`, `/ralph-status`, `/ralph-runs`) route through the same internal handlers as tool actions.
- [x] Validation behavior is identical for command and tool paths (hard-cut, no shims).
- [x] Non-UI mode remains safe.
- [x] Tests cover tool registration + tool action flows + shared-path consistency.

## Known gotchas, watchouts, risks

- Divergence risk if command and tool paths fork; must centralize action handlers.
- Start-action schema must be strict enough to prevent malformed runtime config yet flexible enough for LLM-generated structured inputs.
- Tool results should be machine-friendly while preserving useful human summaries.
- Existing Stage 4/5 behavior (status updates, stop semantics, strict validation) must not regress.

## Detailed stage-gated plan

### Stage A — Add RED tests for tool surface and shared path [GATE]

- [x] Add failing tests for `ralph_loop` registration.
- [x] Add failing tests for each action (`start`, `stop`, `status`, `runs`) via tool execute path.
- [x] Add failing tests proving commands call shared handlers (not duplicate logic).
- [x] Run targeted tests and confirm RED.

### Stage B — Implement shared action layer [GATE]

- [x] Extract/introduce internal action functions (`start`, `stop`, `status`, `runs`) that are context-agnostic.
- [x] Keep current validation and runtime behavior unchanged, just routed through shared functions.
- [x] Ensure UI notify + non-UI messaging wrappers remain stable.

### Stage C — Register `ralph_loop` tool [GATE]

- [x] Define tool input schema with action union + optional action-specific fields.
- [x] Implement execute handler that calls shared action layer.
- [x] Return clear text summary payloads (and errors) suitable for LLM/tool use.

### Stage D — GREEN + regression sweep [GATE]

- [x] Run newly added targeted tests.
- [x] Run full Ralph suite: `npx vitest run agent/extensions/ralph-loop/*.test.ts`.
- [x] Verify no regressions in command UX/status/stop semantics.

### Stage E — Docs + final handoff [FINAL GATE]

- [x] Update `agent/extensions/ralph-loop/README.md` with `ralph_loop` tool contract and examples.
- [x] Update parent plan checkbox context as needed.
- [x] Provide concise summary mapping implementation to your NL-first usage goal.
- [x] Pause for your sign-off.
