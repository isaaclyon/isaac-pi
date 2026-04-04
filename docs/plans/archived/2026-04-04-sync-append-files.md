# Sync APPEND files

## Goal
Undo the prompt-template copy and sync the repository's other `APPEND_SYSTEM.md` files to match `agent/APPEND_SYSTEM.md`.

## Acceptance criteria
- [x] `agent/prompts/brainstorm.md` and `agent/prompts/explain.md` are restored to their prior state.
- [x] `.pi/APPEND_SYSTEM.md` matches `agent/APPEND_SYSTEM.md`.
- [x] Top-level `APPEND_SYSTEM.md` matches `agent/APPEND_SYSTEM.md`.
- [x] The branch is clean after commit.

## Notes
- Only the `APPEND_SYSTEM.md` files should change.
- Use the agent copy as the source of truth.
