# Spec 01: Define same-session auto-repair contracts

## Goal

Replace the side-session mental model in the productionize auto state with a same-session repair model that a future implementation can reason about directly. After this spec, the repository should have explicit contracts for what repair mode tracks, what steps it supports, what remains out of scope, and how persisted state survives reload without child-process metadata.

## Must do

- Edit `agent/extensions/productionize/auto.ts` to replace side-session-oriented persisted fields such as `sessionFile`, `childToken`, `spawnTimestamp`, `pid`, and `verifiedCommand` with same-session repair state focused on the active temp worktree, resume checkpoint, last visible repair action, timeout status, and supported failure scope.
- Keep the existing `StepId`-based retry accounting in `buildRetryKey()` and `recordRetryAttempt()`, but document in code and tests that version one supported repair entries are only `commit`, `push`, and `ci`.
- Add or update a pure helper in `auto.ts` or a new adjacent helper file to answer whether a failed step is eligible for same-session repair mode.
- Add the minimum persisted metadata needed to recognize that the current session is in a repair-mode turn, such as a repair-mode flag, active temp-worktree path, and last repair action, without storing side-session child-process identifiers.
- Update `agent/extensions/productionize/types.ts` if shared type aliases need to distinguish same-session repair status values such as `editing` or `validating` from the old subprocess-centric statuses.
- Update `agent/extensions/productionize/auto.test.ts` to cover the new persisted-state shape, supported repair scope, resume metadata, and removal of side-session-only assumptions.
- Preserve the existing explicit resume-matrix helpers (`decideResumePlan`, `invalidateForResume`) unless a later spec changes them deliberately.
- Record in code comments or nearby tests that plain `/productionize` manual mode is unchanged by this refactor.

## Constraints / Must not do

- Do not implement actual repair execution in this spec; keep it to pure contracts, persistence shape, and repair-scope policy.
- Do not silently keep deprecated side-session fields around “just in case” unless they are still needed for an intentional migration seam named in the code.
- Do not broaden supported repair steps beyond `commit`, `push`, and `ci` in version one.
- Do not weaken the explicit resume matrix into heuristics.

## Acceptance Criteria

- A novice reading `auto.ts` can tell that `/productionize auto` now expects same-session repair state, not a side Pi subprocess.
- Persisted auto state can describe an interrupted same-session repair attempt without mentioning child PID verification, session-file replay, or JSON event parsing.
- A reader can tell how the foreground session will recognize repair mode across reloads.
- The supported repair scope is explicit and human-readable in code and tests.
- Resume-plan behavior for unchanged versus changed `HEAD` remains observable and documented by tests.

## Tests

- `cd /Users/isaaclyon/.pi && node --test agent/extensions/productionize/auto.test.ts` passes.
- Add a focused test that a supported step such as `ci` is eligible for same-session repair and an unsupported step such as `merge` is not.
- Add a focused test that reconstructed repair state no longer depends on `sessionFile`, `childToken`, or `pid`.
- Add a focused test that persisted repair state can mark the session as being in repair mode without a side-session file.

## Todo

- [ ] Replace side-session-specific persisted repair fields in `agent/extensions/productionize/auto.ts`.
- [ ] Add a pure helper for supported same-session repair scope.
- [ ] Update shared repair status/type definitions if needed.
- [ ] Expand `agent/extensions/productionize/auto.test.ts` for the new state shape and scope policy.
- [ ] Record the supported-step policy and unchanged manual-mode policy in tests or code comments.
