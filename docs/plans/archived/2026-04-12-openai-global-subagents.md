# OpenAI-only global subagent overrides

## Goal
Create global `pi-subagents` agent overrides under `agent/agents/` that preserve the built-in agent roles/prompts while switching all agents to OpenAI models and thinking levels aligned with a haiku/sonnet/opus-style split.

## Acceptance criteria
- [x] Global user agent overrides exist for the built-in `pi-subagents` agents we use.
- [x] Overrides preserve each built-in agent's role/prompt while changing model defaults to OpenAI-only values.
- [x] The mapping matches the user's preference: haiku-style uses `gpt-5.4-mini` with `thinking: medium`; balanced defaults otherwise.
- [x] Tests verify the presence of the global agent overrides and their model/thinking assignments.
- [x] Plan is archived after completion.

## Notes
- Prefer the smallest safe change: override built-ins rather than modifying installed package files.
- Keep names identical to built-ins so user-scoped agents take precedence automatically.

## Verification
- Added global agent overrides under `agent/agents/` for `scout`, `planner`, `worker`, `reviewer`, `context-builder`, `researcher`, and `delegate`.
- Preserved the built-in agent bodies while swapping model defaults to:
  - `scout` → `openai-codex/gpt-5.4-mini` + `thinking: medium`
  - `planner`, `reviewer` → `openai-codex/gpt-5.4` + `thinking: high`
  - `worker`, `context-builder`, `researcher` → `openai-codex/gpt-5.4` + `thinking: medium`
  - `delegate` remains model-inheriting
- Added `agent/test/openai-global-subagents.test.ts`.
- Ran `npx vitest run agent/test/openai-global-subagents.test.ts`.
- Ran `npx vitest run`.
