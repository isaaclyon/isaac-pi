# Prioritize user questions in system append

## Goal
Add concise system-append guidance telling the agent to answer a user question immediately before doing any other work.

## Acceptance criteria
- [x] `APPEND_SYSTEM.md` includes a short, explicit rule that user questions must be answered before any tool use, planning, or further steps.
- [x] The mirrored append files stay in sync with the updated wording.
- [x] The new wording is concise and easy to follow.

## Notes
- Keep the instruction strict, but tighten the wording slightly for consistency with the existing append style.
- Limit the change to the system append files.
