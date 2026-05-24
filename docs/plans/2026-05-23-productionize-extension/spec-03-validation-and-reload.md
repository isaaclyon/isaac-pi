# Spec 03: Validate and document reload behavior

## Goal

Validate the productionize extension enough for user-level installation and document how to reload and exercise it. After this spec, helper tests pass, plan evidence is current, and the user has clear next steps for Pi reload and manual runtime validation.

## Must do

- Run `node --test agent/extensions/productionize/core.test.ts` from `/Users/isaaclyon/.pi`.
- Run the existing CI watch helper tests if productionize helper code borrowed behavior from `agent/extensions/ci-watch/`.
- Inspect `git status --short` and ensure only intended productionize and plan files are staged/committed for this task.
- Update `docs/plans/2026-05-23-productionize-extension/ExecPlan.md` with validation evidence and outcomes.
- Confirm the plan/spec folder was committed before implementation or record why that checkpoint was skipped, and commit implementation after tests pass.

## Constraints / Must not do

- Do not run `/productionize` for real in this `.pi` repository as part of automated validation because it would intentionally commit, push, open a PR, and possibly merge.
- Do not claim end-to-end success unless a separate disposable GitHub repository happy-path run has actually completed.
- Do not stage or commit unrelated pre-existing dirty files such as settings, disabled extension docs, or vendored ask-user-question files.
- Do not claim end-to-end GitHub success without running the real workflow in a disposable or intended repository.

## Acceptance Criteria

- Focused tests pass with zero failures.
- The plan records what was and was not manually verified.
- The final response tells the user to run `/reload` before `/productionize` if the current Pi session loaded extensions before these files existed.
- Git history contains focused commits for the self-contained create-specs guidance, the productionize plan, and the productionize implementation.
- If disposable-repo validation is not run in this session, the final response clearly labels it as remaining manual validation rather than completed proof.

## Tests

- `node --test agent/extensions/productionize/core.test.ts` passes.
- Optional regression check: `node --test agent/extensions/ci-watch/core.test.ts` still passes.
- Manual disposable-repo validation, when run, proves branch creation, commit, push, PR creation or reuse, check polling, squash merge, and remote branch deletion.

## Todo

- [x] Run focused productionize tests.
- [x] Optionally rerun CI watch tests.
- [x] Confirm `/productionize` is discovered through Pi RPC `get_commands`.
- [x] Update `ExecPlan.md` with validation evidence.
- [ ] Commit implementation files only.
- [ ] Summarize reload and runtime usage for the user.
