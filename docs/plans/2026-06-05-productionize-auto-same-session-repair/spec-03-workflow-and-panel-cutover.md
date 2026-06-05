# Spec 03: Cut `/productionize auto` over to same-session repair mode

## Goal

Use the new same-session repair controller inside the real productionize workflow for supported failures and make the panel explain what is happening. After this spec, `/productionize auto` should enter repair mode for `commit`, `push`, and `ci` failures, show repair progress inline in the existing panel, resume from the explicit checkpoint matrix in the same session, and keep plain `/productionize` on the old manual path.

## Must do

- Edit `agent/extensions/productionize/workflow.ts` so supported auto-repair failures call the new same-session repair controller instead of `repair-runner.start()`.
- Make the workflow start repair by injecting a same-session user turn with `pi.sendUserMessage()` and tracking the resulting repair-mode lifecycle in foreground state.
- Keep the explicit resume matrix based on `decideResumePlan()` and downstream invalidation, but ensure the same-session path updates it using the new repair result shape rather than imported patch metadata.
- Edit `agent/extensions/productionize/index.ts` so `session_start` reconstruction no longer expects child-process reconciliation or side-worker relaunch when auto mode is restored.
- Add or update extension event handlers so repair-mode turns can be recognized and guarded in the same session via `before_agent_start` and `tool_call` interception.
- Edit `agent/extensions/productionize/panel.ts` so auto repair details show same-session concepts such as `repair mode active`, `attempt 1/3`, `last action`, timeout status, and `resuming from ...`, instead of `side session` and child event wording.
- Keep the failure-summary path in the main session only. A supported repair attempt should append a concise summary to the current session history without referencing a side-session artifact.
- Route only `commit`, `push`, and `ci` recoverable failures through same-session repair mode in version one. Leave unsupported recoverable steps on the explicit stop path with a clear summary.
- Preserve the current plain `/productionize` manual behavior, including fix-instruction generation and `[F] Fix in Pi` panel behavior.
- Add or update focused tests in `agent/extensions/productionize/workflow-auto.test.ts` for supported-step routing, unsupported-step stopping, and same-session summary behavior.
- Update `agent/extensions/productionize/workflow-auto.integration.test.ts` so it proves the supported path can repair and resume without a side-session transcript or patch import step.

## Constraints / Must not do

- Do not change plain `/productionize` semantics in this spec.
- Do not leave the mechanism for “same-session repair” implicit; the implementation must use current Pi APIs rather than hypothetical session retargeting.
- Do not widen version-one repair scope beyond `commit`, `push`, and `ci`.
- Do not leave side-session wording in the panel once the same-session path is active.
- Do not convert the explicit resume matrix into a heuristic based on guesses about changed files.

## Acceptance Criteria

- A supported `/productionize auto` failure shows clearly in the panel that the current session is now in repair mode.
- The panel’s inline status makes hangs diagnosable by exposing the last repair action or timeout state.
- After a successful supported repair, productionize resumes from the documented checkpoint in the same session and clears downstream state correctly when `HEAD` changes.
- Unsupported failures stop cleanly with a summary instead of accidentally trying to use deleted side-session behavior.

## Tests

- `cd /Users/isaaclyon/.pi && node --test agent/extensions/productionize/workflow-auto.test.ts agent/extensions/productionize/workflow-auto.integration.test.ts` passes.
- Add a test that a `ci` failure enters same-session repair mode by issuing a same-session repair turn and records a main-session-only summary.
- Add a test that an unsupported recoverable step such as `merge` does not enter same-session repair mode in version one.
- Add an integration-style test that changed `HEAD` during same-session repair still resets downstream PR/check state before resume.

## Todo

- [ ] Replace workflow calls to `repair-runner.start()` with the same-session repair controller for supported steps.
- [ ] Wire the repair-mode turn start through `pi.sendUserMessage()` and same-session event handlers.
- [ ] Update session reconstruction in `index.ts` for no-child-process repair mode.
- [ ] Rewrite panel auto-repair details for same-session visibility.
- [ ] Keep manual `/productionize` behavior unchanged.
- [ ] Expand workflow auto tests and integration tests for same-session routing and resume.
