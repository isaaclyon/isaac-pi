# pi-review-loop: headless worker passes

## Goal
Replace the current in-session review recursion in `pi-review-loop` with sequential headless `pi -p` review passes that run in a fresh context window, can edit the same branch, and return a stop/continue result to the parent session.

## Design choice
Use a subprocess worker model:
- the extension acts as an orchestrator in the parent session
- each pass spawns `pi -p --mode json --no-session` in the repo root
- the worker receives a generated review prompt and is allowed to edit files directly
- the worker emits a structured final result that the parent parses to decide whether to continue
- the parent session receives pass summaries via notifications and persisted session entries

To avoid recursive self-loading, the worker process is tagged with an environment variable that makes `pi-review-loop` no-op in worker mode.

## Plan
1. Add tests for the worker-mode recursion guard and the worker spawn/result contract.
2. Extract a helper that launches a headless `pi` review worker, parses its final output, and supports cancellation.
3. Refactor `index.ts` so `/review-start` and auto-trigger paths schedule sequential worker passes instead of sending follow-up prompts in-session.
4. Keep command/tool status reporting and persisted pass summaries aligned with the new workflow.
5. Run the focused tests for the vendored package, then archive this plan.

## Verification
- Worker-mode guard test passes.
- Headless worker helper tests pass.
- Review-loop command/tool behavior still reports start/stop/status correctly.
- The package no longer uses `pi.sendUserMessage(...)` to recurse within the same session.
