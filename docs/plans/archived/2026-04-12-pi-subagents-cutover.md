# Cut over to `pi-subagents`

## Goal
Replace the current subagents package/config with `pi-subagents`, remove the old subagents package reference, and clean up repo guidance that still points at the manual dispatch-based subagent workflow.

## Acceptance criteria
- [x] `agent/settings.json` installs `npm:pi-subagents`.
- [x] `agent/settings.json` no longer references `npm:@tintinweb/pi-subagents`.
- [x] Repo append-system guidance no longer tells the agent to use the old `interactive_shell` dispatch workflow specifically for subagents.
- [x] Tests lock the desired subagent package/config state.
- [x] Verification confirms no current repo config/docs still reference the old subagents package.

## Notes
- The user said a clean replacement is preferred and breaking changes are acceptable.
- Keep the change as small as possible; do not add compatibility shims.
- Treat this as a config/guidance cutover, not a broader agent-system rewrite.

## Verification
- Added `agent/test/subagents-cutover.test.ts` to assert the official package is configured and the old manual dispatch guidance is gone from `APPEND_SYSTEM.md` and `.pi/APPEND_SYSTEM.md`.
- Ran `pi remove npm:@tintinweb/pi-subagents` (the settings entry was already gone by then, so Pi reported no matching package after removal work).
- Ran `pi install npm:pi-subagents`.
- Ran `npx vitest run agent/test/subagents-cutover.test.ts`.
- Ran `npx vitest run`.
- Searched current repo config/docs and confirmed no remaining `@tintinweb/pi-subagents` references outside session history.
