# Tab status overrides core session names

## Goal
Make `agent/extensions/tab-status.ts` let both `/rename-tab` and automatic summaries control the visible tab label even when Pi has a core session name.

## Chosen behavior
- `/rename-tab <name>` always changes the visible tab title.
- Automatic summary labels also update the visible tab title even if `ctx.sessionManager.getSessionName()` is set.
- Core session names remain available as fallback labels when neither manual nor summary modes are active.

## Plan
1. Add failing tests that reproduce the current bug: manual rename hidden by a session name, and automatic summary blocked by a session name.
2. Update `agent/extensions/tab-status.ts` precedence rules so manual and summary modes outrank session names for display and refresh behavior.
3. Run targeted Vitest coverage, archive the plan, and commit the fix.

## Verification
- `agent/test/extensions/tab-status.test.ts` covers both manual and automatic override behavior.
- Targeted Vitest run passes.