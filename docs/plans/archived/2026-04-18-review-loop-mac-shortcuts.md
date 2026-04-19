# Review-loop mac-friendly worker controls plan

## Goal
Add review-loop-specific controls so an active in-session review worker can be backgrounded or shut down without relying on `pi-interactive-shell`'s `alt+shift+f` focus shortcut.

## User decision
Chosen behavior:
- `Escape` kills the active review worker and exits review mode
- `Ctrl+B` backgrounds the active review worker
- `Ctrl+Shift+R` focuses/unfocuses the active review worker overlay

## Acceptance criteria
1. While a review worker is active, `Escape` aborts the worker, exits review mode, and clears review status/overlay state.
2. While a review worker is active, `Ctrl+B` backgrounds the worker without exiting review mode.
3. While a review worker is active, `Ctrl+Shift+R` toggles focus on the worker overlay.
4. When no worker is active, `Escape` and `Ctrl+B` fall through to normal editor behavior, while `Ctrl+Shift+R` shows a helpful info message.
5. Behavior is covered by focused tests.

## Implementation outline
1. Extend the worker overlay launcher handle to expose control methods (`kill`, `background`, `toggleFocus`) in addition to `completion`.
2. Track the active worker launch handle in `index.ts` only for the lifetime of a pass.
3. Add failing tests for the three review-loop shortcuts and inactive-worker behavior.
4. Wire `Escape` and `Ctrl+B` through `onTerminalInput` so they can coexist with built-in keybindings, and register `Ctrl+Shift+R` as a normal shortcut.
5. Update overlay/footer copy and README docs to advertise the new controls.
6. Run focused tests and diagnostics, then archive this plan.
