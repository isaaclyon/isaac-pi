# Spec 04: Prove the refactor and remove obsolete side-session machinery

## Goal

Demonstrate that same-session repair mode actually works in the real user flow, then delete the side-session code that is no longer needed. After this spec, the repository should have a validated same-session `/productionize auto` path, explicit proof evidence, and no remaining production code that depends on side Pi repair sessions for version-one flows.

## Must do

- Run the focused automated productionize auto tests after the cutover lands and record the results in `docs/plans/2026-06-05-productionize-auto-same-session-repair/ExecPlan.md`.
- Perform the integrated proof in a disposable GitHub repository by running `/productionize auto` against one intentionally repairable failure in the supported scope and record what happened in `ExecPlan.md`.
- After proof passes, remove obsolete side-session implementation files or dead paths from `agent/extensions/productionize/repair-runner.ts`, `repair-guard.ts`, `panel.ts`, `workflow.ts`, `auto.ts`, and related tests.
- Replace or delete tests that only exist to protect the side-session subprocess design, and add replacement tests that protect same-session repair mode instead.
- Update the current productionize auto plan documentation so it no longer claims the side-session model is the active architecture for version one.
- Write the implementation outcome, any remaining non-goals, and any deferred follow-up work into `ExecPlan.md` under `Outcomes & Retrospective`.

## Constraints / Must not do

- Do not delete side-session code before the same-session path has passed both focused automated tests and the disposable-repository proof.
- Do not count local unit tests alone as sufficient proof.
- Do not expand this cleanup into unrelated productionize redesign work.
- Do not broaden repair permissions while deleting the old machinery.

## Acceptance Criteria

- `ExecPlan.md` contains explicit evidence that same-session repair mode worked in the real `/productionize auto` path.
- The repository no longer depends on a side-session JSONL repair transcript, child-process event parsing, or patch import/export to implement version-one auto repair.
- Test coverage now protects the new architecture rather than the removed one.
- Remaining non-goals and follow-up risks are clearly documented.

## Tests

- `cd /Users/isaaclyon/.pi && node --test agent/extensions/productionize/core.test.ts agent/extensions/productionize/auto.test.ts agent/extensions/productionize/repair-mode.test.ts agent/extensions/productionize/workflow-auto.test.ts agent/extensions/productionize/workflow-auto.integration.test.ts` passes.
- Execute the disposable GitHub repository proof manually through the Pi TUI and record the observed checkpoint, repair, resume, and merge behavior in `ExecPlan.md`.
- Remove or replace any test that only verifies side-session subprocess behavior once the new path is the production path.

## Todo

- [ ] Run and record focused automated test results after cutover.
- [ ] Execute and document the disposable GitHub repository proof.
- [ ] Delete obsolete side-session production code and subprocess-only tests.
- [ ] Update documentation and retrospective notes to match the new architecture.
