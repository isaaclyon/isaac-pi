# Add LCM compaction model logging and switch to Cerebras GPT OSS 120B

## Context
- The vendored `pi-lcm` package is loaded from `~/.pi/.pi/vendor/pi-lcm`.
- Current compaction model selection is not logged clearly, so successful compactions do not reveal which model actually ran.
- The user wants the compaction path to prefer `cerebras/gpt-oss-120b` and wants the Cerebras API key set in `~/.pi/agent/auth.json`.

## Goals
1. Add explicit logs for compaction model selection attempts, success, fallback, and failure.
2. Keep logging focused and useful, with debug-mode notifications for visibility during compaction.
3. Switch `lcm.compactionModels` to prefer `cerebras/gpt-oss-120b`.
4. Set the Cerebras API key in `~/.pi/agent/auth.json` to the user-provided value.
5. Cover the logging behavior with focused regression tests before implementation.

## Acceptance criteria
- A failing test first demonstrates missing compaction-model logging behavior.
- After implementation, tests pass and show:
  - attempted model logging
  - success logging when a model returns text
  - fallback logging when primary candidates fail and `ctx.model` is used
- `agent/settings.json` includes `lcm.compactionModels` with `cerebras/gpt-oss-120b` first.
- `agent/auth.json` contains the requested Cerebras key.

## TDD slices
1. Add a focused test for successful primary-model logging.
2. Add a focused test for fallback-model logging.
3. Implement the smallest extraction/refactor needed to test and log model selection.
4. Run narrow tests, then the vendored package test suite.
5. Update config/auth files.

## Notes
- Avoid logging secrets or raw auth headers.
- Keep the vendored package close to upstream except for the local patches.
- Archive this plan after the work is complete.
