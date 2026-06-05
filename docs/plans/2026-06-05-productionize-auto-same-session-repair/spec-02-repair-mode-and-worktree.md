# Spec 02: Build the same-session repair-mode controller

## Goal

Add the new repair engine that runs inside the user’s existing Pi session while preserving the temporary-worktree isolation boundary. After this spec, the repository should have a concrete controller that can start a guarded repair attempt, expose structured progress states, run narrowly-scoped local validation when allowed, enforce a hard timeout, and return a foreground-friendly summary result without using `pi --mode json` subprocesses or patch export/import.

## Must do

- Create a new module under `agent/extensions/productionize/`, preferably `repair-mode.ts`, that owns same-session repair lifecycle.
- Start the actual repair turn by calling `pi.sendUserMessage()` in the current session with a repair prompt, rather than spawning `pi --mode json` or switching sessions.
- Reuse or extract the still-useful temp-worktree setup and teardown pieces from `agent/extensions/productionize/repair-runner.ts`, but stop depending on child-process JSON event streaming and patch export/import for version-one repair execution.
- Define a controller API such as `start(input)` / `abort()` that returns a structured result containing at least: `outcome`, `headShaBefore`, `headShaAfter`, `baseBranch`, `baseShaBefore`, `tempWorktree`, `summary`, `lastAction`, and whether focused local validation ran.
- Keep repair execution bound to a temporary git worktree rooted at the current feature branch head, with explicit cleanup rules when the run succeeds, fails before edits, or stops after edits.
- Add runtime guards so that while repair mode is active, the current session cannot recursively trigger `/productionize*`, cannot call GitHub or remote mutation paths, cannot push or merge, and cannot leave the repair worktree unexpectedly.
- Implement those guards with the real Pi extension seams available in this repository: `before_agent_start` for repair-mode prompt/context injection and `tool_call` interception for blocking or rewriting unsafe operations.
- Reuse the confinement logic from `agent/extensions/productionize/repair-guard.ts` as the starting point for rebasing `read`/`edit`/`write` paths into the active temp worktree and rejecting escapes.
- Allow only focused local validation commands relevant to the failing path. The implementation should name the initial allowlist in code and tests, for example touched-package tests, lint on touched files, or a failing test rerun.
- Add a hard repair timeout and produce a structured failed result instead of waiting forever.
- Add focused tests in a new file such as `agent/extensions/productionize/repair-mode.test.ts` for temp-worktree setup, guard enforcement, timeout behavior, and focused-validation policy.
- Leave `repair-runner.ts` intact only to the degree needed for the cutover spec; this spec may extract helpers from it, but should not delete it yet.

## Constraints / Must not do

- Do not let same-session repair talk to GitHub, push commits, merge branches, or mutate PR state.
- Do not assume a session-wide cwd switch API exists; the spec must be implementable with current extension APIs.
- Do not run unrestricted shell validation during repair mode.
- Do not perform the full workflow cutover in this spec; keep this work scoped to the new controller and its tests.
- Do not remove the temp-worktree boundary by editing the main worktree directly.

## Acceptance Criteria

- The repository contains one clear same-session repair controller module with a testable API.
- A reader can identify the allowed local validation surface and the blocked remote-mutation surface from code and tests.
- A stuck repair attempt yields a bounded failure result with an explanatory summary, not an indefinite running state.
- No same-session repair result requires a side-session file or patch artifact to continue.

## Tests

- `cd /Users/isaaclyon/.pi && node --test agent/extensions/productionize/repair-mode.test.ts` passes.
- Add a test that a blocked action such as recursive `/productionize auto` or a GitHub command is rejected while repair mode is active.
- Add a test that `read`/`edit`/`write` paths are rewritten or confined to the active temp worktree and cannot escape it.
- Add a test that a stuck repair attempt times out and reports a failed result.
- Add a test that a temp worktree is created for the attempt and cleaned up in the success path.

## Todo

- [ ] Add `agent/extensions/productionize/repair-mode.ts` with same-session repair lifecycle.
- [ ] Extract or reuse temp-worktree helpers from `repair-runner.ts`.
- [ ] Implement repair-mode guard enforcement for unsafe commands, actions, and path confinement in the active temp worktree.
- [ ] Implement focused local validation policy and timeout handling.
- [ ] Add `agent/extensions/productionize/repair-mode.test.ts`.
