# /rename-tab command

## Goal
Add a manual `/rename-tab` command to `agent/extensions/tab-status.ts` that temporarily overrides the tab label for the current session.

## Chosen behavior
- `/rename-tab <name>` sets a temporary manual tab label.
- The manual label stays in place during normal prompt/fallback refreshes.
- The next automatic summarizer update may replace it.
- Empty input shows usage guidance.
- This does not persist as the session name.

## Plan
1. Add focused tests for command registration, usage validation, and temporary manual-label stickiness across prompt refreshes.
2. Update `agent/extensions/tab-status.ts` to register `/rename-tab` and introduce a temporary manual label mode.
3. Run targeted Vitest tests for `tab-status` and archive this plan.

## Verification
- `agent/test/extensions/tab-status.test.ts` covers the new command behavior.
- Targeted Vitest run passes.