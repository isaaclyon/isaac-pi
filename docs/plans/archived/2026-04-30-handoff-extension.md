# Add handoff extension and deprecate prompt command

## Goal
Replace the global prompt-template `/handoff` workflow with Pi's official handoff extension command so `/handoff <goal>` generates an editable prompt and starts a new session.

## Plan
1. Add the official handoff extension under `agent/extensions/handoff.ts`.
   - Verify: file is in an auto-discovered extension location.
2. Deprecate the existing prompt template by moving `agent/prompts/handoff.md` out of the non-recursive prompts directory.
   - Verify: no top-level `agent/prompts/handoff.md` remains, so the prompt-template command is no longer discovered.
3. Sanity-check the resulting files and archive this plan.
   - Verify: read key files/list directories.

## Notes
- `~/.pi` is not a Git repository, so there is no commit step available here.
