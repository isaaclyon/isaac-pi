# Spec 04: Prove the unattended path to merge

## Goal

Show that the new auto mode ships a real user-facing capability rather than a set of isolated helper changes. After this spec, the codebase has focused automated integration coverage for the repair-resume state machine, a semi-real local-repo proof for head-change invalidation, and an explicit disposable-repository proof that `/productionize auto` can recover from a failing check and still reach final merge.

## Must do

- Add `agent/extensions/productionize/workflow-auto.integration.test.ts` to exercise a mocked end-to-end flow: branch or PR setup, recoverable CI or merge failure, side repair success, checkpoint rerun, downstream invalidation on head change, and final merge success.
- Add one semi-real repository integration test that uses a temporary local git repository plus fake `gh` command responses to prove real git state transitions, changed `HEAD`, and downstream invalidation behavior without touching GitHub.
- Run the full focused test command covering the existing helper tests plus the new auto-mode tests.
- Perform a manual disposable-repository proof with a real GitHub repository that has at least one intentionally failing check the side agent can fix.
- Record the disposable-repository transcript and outcome in `docs/plans/2026-06-04-productionize-auto-mode/ExecPlan.md`, including what was automated, what was manual, and any remaining gaps.
- Verify that the side-session audit trail remains inspectable after a successful merge and that the main session contains the compact repair summary.

## Constraints / Must not do

- Do not claim success from unit tests alone; the feature promise is unattended recovery to merge.
- Do not run `/productionize auto` for real in this `.pi` repository.
- Do not count a repair attempt as successful unless the foreground workflow reruns the checkpoint and observes the expected result on the new branch state.
- Do not omit the side-session audit requirement from validation.

## Acceptance Criteria

- Automated integration coverage proves that the foreground workflow can survive a recoverable failure, accept a repair result, rerun from the safe checkpoint, and finish successfully.
- The semi-real repository test proves real local git transitions, including a changed `HEAD` and full invalidation of `pr`, `ci`, `merge`, `return`, PR metadata, and displayed checks.
- The manual disposable-repository run proves the real GitHub boundary: PR creation or reuse, failing check, side repair, green recheck, and squash merge.
- The ExecPlan clearly labels any validation that remains manual-only or still unproven.
- A future contributor can repeat the validation from the recorded commands and scenario description without guessing.

## Tests

- `node --test agent/extensions/productionize/workflow-auto.integration.test.ts` passes.
- If the semi-real repo test lives in its own file, `node --test agent/extensions/productionize/workflow-auto.semi-real.test.ts` passes.
- `node --test agent/extensions/productionize/core.test.ts agent/extensions/productionize/auto.test.ts agent/extensions/productionize/repair-runner.test.ts agent/extensions/productionize/workflow-auto.test.ts agent/extensions/productionize/workflow-auto.integration.test.ts agent/extensions/productionize/workflow-auto.semi-real.test.ts` passes.
- Manual disposable-repository run: `/reload`, then `/productionize auto` in a test GitHub repo with one failing check that the side agent can repair.
- Manual audit check: verify the main session contains the repair summary and the side-session file remains available for inspection after merge.

## Todo

- [ ] Add `workflow-auto.integration.test.ts`.
- [ ] Add the semi-real local-repo invalidation test.
- [ ] Run the full focused Node test suite.
- [ ] Run the disposable-repository proof.
- [ ] Record transcripts and validation evidence in `ExecPlan.md`.
- [ ] Note any residual operational risk or follow-up work.