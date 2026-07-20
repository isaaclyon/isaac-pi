---
name: review-with-subagents
description: "Choose no review, a basic review, an expert review, or a focused simplification pass based on the risk and shape of coding work."
---

# Review With Subagents

Use the smallest review pass that provides meaningful independent scrutiny. Reviewer count should be proportional to risk, not the number of available lenses.

## Core Rule

`basic-reviewer` and `expert-reviewer` are alternatives. Do not spawn both for the same change unless the first review uncovers a distinct reason for escalation.

A specialist is additive only when the change presents a concrete specialist concern. Do not fan out reviewers merely because several lenses could technically apply.

## Routing

### No subagent review

Skip reviewer subagents for trivial, low-risk work such as:

- typo, comment, or formatting corrections
- obvious metadata updates
- mechanical edits with no behavioral effect
- changes fully covered by a narrow deterministic validation

Run the relevant validation directly instead.

### Basic reviewer — default

Use `basic-reviewer` for ordinary bounded changes:

- small fixes and features
- localized behavior changes, often within one to three files
- tests or configuration with limited impact
- work with clear acceptance criteria and easy rollback

The basic reviewer checks correctness, regressions, tests, and obvious maintainability problems. This should cover most reviewed implementation work.

### Expert reviewer — use instead of basic

Use `expert-reviewer` when deeper semantic or operational judgment is warranted:

- cross-cutting or high-risk changes
- public APIs, schemas, persistence, migrations, security, or concurrency
- integrations and production-readiness claims
- ambiguous requirements where checklist completion may miss the intended outcome
- expensive or difficult-to-reverse failure modes
- work whose completion depends on important assumptions or end-to-end evidence

The expert reviewer incorporates intent validation, architecture, operational readiness, and deep correctness review. Do not add a separate intent validator.

### Simplifier — focused specialist

Use `simplifier` only when structural complexity is a material concern:

- refactors or architecture changes
- new abstractions, helpers, options, hooks, or extension points
- an implementation that appears larger than the request
- duplicated concepts or logic with credible drift risk
- misplaced responsibilities or problematic dependency direction

Do not add it automatically to a basic or expert review. It may be used alone for behavior-preserving cleanup, or alongside one reviewer when correctness and simplification are genuinely independent concerns.

### Thought partner — before implementation

Use `thought-partner` to pressure-test an existing plan or proposed approach before implementation when assumptions, scope, or design choices deserve adversarial scrutiny. It is not a post-implementation reviewer and should not be required for routine work.

Use `scout` first only when the relevant code area is unfamiliar or the review cannot be scoped without repository discovery.

## Reviewer Count

- trivial work: 0 reviewers
- ordinary bounded changes: 1 basic reviewer
- high-risk or semantically ambiguous changes: 1 expert reviewer
- concrete structural concern: add or substitute 1 simplifier
- exceptional cross-cutting work: at most 2 reviewers unless the user explicitly requests broader review

File count is a useful heuristic, not the deciding factor. A one-file migration can require expert review; a mechanical multi-file rename may require none.

## Workflow

1. Identify the actual behavioral and operational risk.
2. Decide whether independent review adds value at all.
3. Choose `basic-reviewer` or `expert-reviewer`, never both by default.
4. Add `simplifier` only for a concrete structural question.
5. Spawn independent reviews in parallel only when there is more than one justified reviewer.
6. Reconcile findings, apply only actionable feedback, and run targeted validation.
7. Escalate from basic to expert only when evidence from the change or review warrants it.

## Done Criteria

- Review depth matches the change's risk and reversibility.
- Basic and expert review were not redundantly combined.
- Specialist use was tied to a concrete concern.
- No reviewer was launched solely to satisfy ceremony.
- Findings were verified and reconciled before completion was claimed.
