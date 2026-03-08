Execute Stage 5 for Ralph loop: finalize validation, run a lightweight end-to-end smoke scenario in this repo, author operator-focused docs, and prepare final sign-off summary.

## User context

- You confirmed: “Let’s do stage 5.”
- Prior stages (0–4) are complete, including review remediation for Stage 4 issues.
- Interview choices for this stage:
  - E2E target: **current repo lightweight smoke task**
  - Docs depth: **operator-focused quickstart + command reference**
- Goal now is to close the remaining checklist items in the v1 plan and make the feature handoff-ready.

## Key acceptance criteria

- [x] Stage 5 checklist in `docs/plans/2026-03-07-ralph-loop-extension-v1.md` is completed with evidence.
- [x] Validation coverage includes:
  - [x] loop stop conditions
  - [x] evaluator correctness
  - [x] persistence/resume behavior
  - [x] command argument validation
- [x] End-to-end smoke scenario is executed in this repo and results recorded.
- [x] `agent/extensions/ralph-loop/README.md` exists with operator-focused quickstart + command reference.
- [x] Preset guidance is documented clearly for:
  - [x] `deterministic-tdd`
  - [x] `quantitative-only`
  - [x] `hybrid`
- [x] Final summary prepared for explicit sign-off.

## Known gotchas, watchouts, risks

- tmux and local environment differences can cause flaky E2E behavior if assumptions are implicit.
- Persistence/resume validation must distinguish DB persistence from in-memory active-run registry behavior.
- Arg-validation tests should enforce hard-cut behavior (reject invalid inputs; no silent fallback shims).
- E2E smoke should avoid broad repo mutations to keep verification deterministic and low-risk.

## Detailed step-by-step instructions (stage-gated)

### Stage 5A — Gap audit and RED tests [GATE]

- [x] Audit existing Ralph tests for explicit Stage 5 criterion coverage and identify gaps.
- [x] Add failing tests for any uncovered behaviors:
  - [x] command arg validation edge cases
  - [x] persistence/resume behavior specifics
  - [x] remaining stop/evaluator edge assertions not already explicit
- [x] Run targeted tests and confirm expected RED where new behavior is required.

### Stage 5B — Implement minimal code to satisfy new tests [GATE]

- [x] Implement only the required behavior to turn new RED tests GREEN.
- [x] Keep hard-cut semantics (no backward-compatible aliases/shims).
- [x] Ensure non-UI mode remains safe.

### Stage 5C — E2E smoke scenario in current repo [GATE]

- [x] Create a lightweight Ralph smoke config/task for this repo (non-destructive).
- [x] Run one end-to-end Ralph scenario (`/ralph-start` equivalent path + observe completion/status/runs).
- [x] Capture evidence (status transitions, run terminal state, relevant artifacts/logs).

### Stage 5D — Documentation [GATE]

- [x] Add `agent/extensions/ralph-loop/README.md` with operator-focused structure:
  - [x] quickstart
  - [x] command reference
  - [x] config format
  - [x] preset examples (`deterministic-tdd`, `quantitative-only`, `hybrid`)
  - [x] troubleshooting basics
- [x] Verify docs match implemented behavior exactly.

### Stage 5E — Final validation and handoff [FINAL GATE]

- [x] Run full Ralph-loop test suite:
  - [x] `npx vitest run agent/extensions/ralph-loop/*.test.ts`
- [x] Update Stage 5 checkboxes in `docs/plans/2026-03-07-ralph-loop-extension-v1.md`.
- [x] Produce final review summary mapping each Stage 5 acceptance item to evidence.
- [x] Pause for your explicit sign-off.

## Evidence

- Targeted regression run:
  - `npx vitest run agent/extensions/ralph-loop/index.test.ts agent/extensions/ralph-loop/store.test.ts`
- Stage 5 smoke scenario (lightweight end-to-end orchestration path in this repo context):
  - `npx vitest run agent/extensions/ralph-loop/stage5-smoke.test.ts`
- Full Ralph-loop suite:
  - `npx vitest run agent/extensions/ralph-loop/*.test.ts`
