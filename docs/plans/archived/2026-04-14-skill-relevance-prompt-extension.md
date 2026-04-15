# Implementation Plan: Global skill-relevance prompt extension

## Goal
Add a global pi extension that appends a strictly exact instruction to each turn so the assistant checks whether any available skills are relevant before proceeding.

## Requirements
- Install globally under `~/.pi/agent/extensions/` so it applies to all prompts.
- Keep the wording strictly exact for the injected instruction.
- Only include the relevant-skill branch for now.
- Keep the change minimal and easy to adjust later.

## Plan
1. Inspect the existing extension patterns and confirm the right hook for per-turn system prompt modification.
2. Add a new global extension file under `agent/extensions/` that appends the exact instruction in `before_agent_start`.
3. Verify the file is discoverable and that the instruction text matches the requested wording exactly.
4. Archive this plan after completion.

## Notes
- The extension should use the smallest possible implementation.
- If the exact instruction needs to change later, it should be isolated in a single constant.
