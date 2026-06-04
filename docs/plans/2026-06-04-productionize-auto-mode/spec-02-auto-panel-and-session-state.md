# Spec 02: Surface auto mode in the command, panel, and session state

## Goal

Make auto mode visible and persistent from the user’s point of view. After this spec, `/productionize auto` is a recognized command form, the productionize panel shows inline repair-loop status under the active checkpoint, cancellation semantics cover both foreground and background work, and session reconstruction can restore the last known auto-run state after reload or restart.

## Must do

- Edit `agent/extensions/productionize/index.ts` to parse command arguments and pass `auto: true` into the workflow state when the user runs `/productionize auto`.
- Edit `agent/extensions/productionize/types.ts` to extend `ProductionizeState` with the fields needed for auto mode, including whether auto mode is enabled, retry status, current repair attempt metadata, side-session file, reconstruction markers, and the persisted foreground checkpoint needed for resume after reload.
- Edit `agent/extensions/productionize/panel.ts` so the active workflow step can render inline repair-loop details such as `repair attempt 1/3`, `waiting for side agent`, `side session: ...`, and `resuming from <checkpoint>`.
- Register session reconstruction logic in the productionize extension so `pi.appendEntry(...)` state can be replayed on `session_start` and reflected in the panel or controller state.
- Introduce a resumable foreground run controller so `session_start` can reopen the panel and resume the checkpoint machine from persisted state after `/reload` or restart instead of depending on the original one-shot command callback.
- Reconcile in-flight repair attempts on `session_start` with a deterministic kill-orphan-and-relaunch strategy: if persisted state says a repair child was active and its PID still exists, verify the PID still matches the recorded Pi child metadata, stable child token, and spawn timestamp before terminating it, append an interrupted summary, and relaunch exactly one replacement child for that checkpoint.
- Persist meaningful auto-run milestones with `pi.appendEntry(...)`, including auto-run start, repair-attempt start, repair-attempt end, retry exhaustion, and cancellation.
- Emit a compact visible repair summary back into the main session after each attempt, using a normal extension message path so the audit survives beyond the panel lifecycle.
- Persist a matching summary entry that includes at least step ID, attempt number, old SHA, new SHA when present, outcome, side-session file, and timestamp so the audit is reconstructable even without the panel.
- Ensure cancelling auto mode aborts both the foreground workflow `AbortController` and the active repair-runner child process.
- Add panel- or state-focused tests in `agent/extensions/productionize/auto.test.ts` or a dedicated `panel-auto.test.ts` if needed.

## Constraints / Must not do

- Do not add a new top-level workflow step named Repair. The user asked for repair state inline under the currently active checkpoint.
- Do not require manual prompt review or manual submit for auto mode. The side-agent handoff must be sent automatically.
- Do not silently discard persisted auto-run state on reload or restart.
- Do not send auto-repair attempts for unrecoverable prerequisites such as missing GitHub auth or non-GitHub remotes.

## Acceptance Criteria

- `/productionize auto` launches the same full-screen panel, but the status text and active-step detail make it obvious that unattended repair mode is enabled.
- When a repair attempt starts, the panel shows inline repair status instead of falling back to the old manual `F`-to-fix-only flow.
- When Pi reloads or restarts during an auto run, the extension reconstructs the last persisted auto state instead of presenting an empty fresh state, reopens the productionize panel in TUI mode, restores the foreground checkpoint controller, and deterministically reconciles any previously active repair child by killing only a verified matching child PID and relaunching once.
- Cancelling auto mode stops the child repair process as well as the foreground productionize run.
- The main session contains both a visible repair summary message and a persisted summary entry after each attempt, while the side session remains available for deeper inspection.

## Tests

- `node --test agent/extensions/productionize/auto.test.ts` passes.
- If a dedicated panel test file is added, `node --test agent/extensions/productionize/panel-auto.test.ts` passes.
- Add at least one test proving `/productionize auto` parses as auto mode while `/productionize` remains the manual mode.
- Add at least one test proving persisted entries reconstruct the latest retry status, side-session reference, and last repair summary metadata.
- Add at least one reload-recovery test proving an active persisted repair attempt kills only a verified matching child PID using the stable child token plus spawn timestamp, restores the foreground checkpoint controller, and relaunches exactly one replacement child, never duplicates.
- Add at least one render test proving the panel shows inline repair-loop text without adding a new workflow step.

## Todo

- [ ] Parse the `auto` command argument in `index.ts`.
- [ ] Extend `ProductionizeState` for auto-mode fields.
- [ ] Update `panel.ts` for inline repair-loop rendering.
- [ ] Add session-start reconstruction logic.
- [ ] Persist auto-run milestones with `pi.appendEntry(...)`.
- [ ] Emit visible repair summaries into the main session.
- [ ] Cover parsing and reconstruction with tests.