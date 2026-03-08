Remediate high-priority Ralph loop code review findings affecting correctness, success evaluation, and tmux command safety.

## User context

- You asked to act on a review branch summary that identified concrete P1/P2 defects in the new `agent/extensions/ralph-loop/` implementation.
- You want fail-fast behavior and early success termination.
- Interview decisions captured just now:
  - Failure policy: **strict fail-fast now**
  - Success semantics: **succeed immediately when success criteria are met**

## Key acceptance criteria

- [ ] Preserve project-level `defaultRun.success` during env-override merge in `config.ts`.
- [ ] Loop executor must not mark loops completed if child execution failed.
- [ ] Supervisor must evaluate `config.success` and transition run to `succeeded` immediately when satisfied.
- [ ] tmux command builder must shell-escape output redirection path.
- [ ] Output cursor advancement must be correct with blank lines (no duplicate parsing).
- [ ] Regression tests cover each fixed defect.

## Known gotchas, watchouts, risks

- Success evaluation introduces new control flow in supervisor; must not regress current checkpoint/event persistence.
- Parsing child output for exit-failure signals is heuristic unless we explicitly append/parse a sentinel in command output.
- Overly permissive regex/assert handling in quantitative mode can create false positives; default to strict command exit semantics.
- Config merge changes must be minimal and deterministic to avoid silent default resets.

## Detailed step-by-step instructions with stage gates

### Stage A — Tests-first regression harness [GATE]

- [x] Add/adjust failing tests for:
  - [x] config merge preserving `defaultRun.success` during env merge
  - [x] blank-line cursor advancement correctness
  - [x] tmux output path escaping in command string
  - [x] loop executor propagating execution failure state
  - [x] supervisor success transition to `succeeded`
- [x] Run targeted Ralph tests and confirm failures before production changes.

### Stage B — Config + tmux + cursor fixes [GATE]

- [x] Fix `mergeRunConfig` semantics so absent `success` keeps base success config.
- [x] Escape output path in `buildPiCommand` redirection.
- [x] Correct output cursor advancement to track raw line positions even when blank lines are filtered from parsed payload.
- [x] Re-run relevant targeted tests.

### Stage C — Failure propagation + success evaluation [GATE]

- [x] Add child execution failure detection in loop executor (strict fail-fast).
- [x] Return `state: "failed"` on detected child failures and preserve reason in artifacts/summary.
- [x] Implement supervisor-side success evaluation:
  - [x] deterministic-tdd mode
  - [x] quantitative mode
  - [x] basic hybrid/qualitative handling consistent with current config shape
- [x] Stop run immediately on success and set state `succeeded`.
- [x] Re-run full Ralph test suite.

### Stage D — Plan updates + final verification [FINAL GATE]

- [x] Update `docs/plans/2026-03-07-ralph-loop-extension-v1.md` progress checkboxes for completed stages.
- [x] Summarize fixes with file-level mapping to review findings.
- [x] Provide final status and propose next stage work.
