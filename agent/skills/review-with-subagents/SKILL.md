---
name: review-with-subagents
description: "Choose no review, a basic review, an expert review, or a focused simplification pass based on the risk and shape of coding work."
---

# Review With Subagents

Use the smallest review pass that provides meaningful independent scrutiny. Basic review is the strong default for implementation work; expert review is an exception for changes whose size, complexity, or consequences genuinely require deeper judgment. Reviewer count should be proportional to risk, not the number of available lenses.

## Core Rule

`basic-reviewer` and `expert-reviewer` are alternatives. Do not spawn both for the same change unless a basic review uncovers a concrete P0, P1, or P2 concern that requires expert judgment.

Review has a hard limit of two cycles total for a change. A cycle is any post-implementation reviewer pass, whether one or two justified reviewers run in parallel. Use the second cycle only to verify fixes for actionable P0-P2 findings or to perform an evidence-backed escalation from basic to expert. Never start a third cycle, recursively review a review, or ask a reviewer to call another reviewer.

A specialist is additive only when the change presents a concrete specialist concern. Do not fan out reviewers merely because several lenses could technically apply.

## Assignment Brief

Do not send a bare prompt such as "review this change." Every reviewer assignment must make the task-specific mission clear without biasing the verdict.

Include the useful parts of this compact brief:

```markdown
Outcome: <what the user should be able to do, or the decision this review must support>
Context: <why the change exists and the relevant acceptance criteria>
Scope: <diff, changed files, plan, or commit to inspect; note allowed adjacent code>
Focus:
- <one to three concrete risks or invariants, and why they matter here>
Evidence: <tests, diagnostics, runtime checks, or known gaps>
Constraints: <non-goals, compatibility expectations, or decisions already made>
Deliverable: <role-specific verdict or questions to answer>
```

Rules for a useful brief:

- Derive `Focus` from the actual change. Do not merely copy the reviewer's generic checklist.
- Supply established context and evidence rather than asking the reviewer to rediscover it.
- State unknowns honestly and ask the reviewer to verify assumptions that affect completion.
- Do not tell the reviewer that the change is correct or suggest the finding it should reach.
- Keep scope bounded, but permit inspection of adjacent integration points needed to verify a claim.
- Omit empty fields and keep the handoff concise; the brief is a decision aid, not ceremony.

Tailor the deliverable and focus to the role:

| Role | Assignment-specific direction |
| --- | --- |
| `basic-reviewer` | Name the changed behavior, its important inputs or failure cases, and the tests expected to prove it. |
| `expert-reviewer` | Name the user outcome, critical invariants, operational or migration risks, and any completion assumptions needing independent verification. |
| `simplifier` | Name the concrete complexity concern and the behavior or constraints that must remain unchanged. |
| `thought-partner` | Provide the proposed approach, unresolved decisions, assumptions to challenge, and the point at which implementation is expected to begin. |

When two justified reviewers run in parallel, give each the shared outcome and evidence but a distinct focus. Do not ask both to perform the same generic review.

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

When uncertain between basic and expert, choose basic. Do not infer that production code automatically requires expert review.

### Expert reviewer — exceptional, use instead of basic

Use `expert-reviewer` only when deeper semantic or operational judgment is warranted and at least one of these escalation conditions is concrete in the change:

- a large or cross-cutting change alters several subsystem boundaries or important end-to-end behavior
- complex invariants, concurrency, security, persistence, migrations, or recovery behavior require specialist reasoning
- a consequential public API, schema, or external integration has difficult compatibility or rollout implications
- failure could cause material data loss, security exposure, prolonged outage, or an expensive and difficult rollback
- completion depends on ambiguous product intent or important operational assumptions that targeted tests cannot settle
- a basic review found a concrete P0-P2 concern whose resolution requires deeper architectural or operational judgment

Routine production code, ordinary integrations, localized API changes, and moderate file counts remain basic-review territory when behavior and validation are clear. The expert reviewer incorporates intent validation, architecture, operational readiness, and deep correctness review. Do not add a separate intent validator.

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
- large, complex, high-consequence, or semantically ambiguous changes meeting an escalation condition: 1 expert reviewer
- concrete structural concern: add or substitute 1 simplifier
- exceptional cross-cutting work: at most 2 reviewers unless the user explicitly requests broader review

File count is a useful heuristic, not the deciding factor. A one-file migration can require expert review; a mechanical multi-file rename may require none.

## Review Cycle Limit

- Cycle 1 is the normal review and should usually be one `basic-reviewer` pass.
- Cycle 2 is optional and targeted: verify fixes for P0-P2 findings, or escalate to `expert-reviewer` when cycle 1 produced concrete evidence that meets the expert criteria.
- Stop after cycle 1 when findings are absent, below P2, or can be verified directly with deterministic checks.
- Stop after cycle 2 regardless. Resolve remaining material issues directly and report any unresolved risk instead of spawning more reviewers.
- Parallel reviewers in one round count as one cycle, but remain capped by the reviewer-count rules.

## Workflow

1. Identify the actual behavioral and operational risk.
2. Decide whether independent review adds value at all.
3. Choose `basic-reviewer` or `expert-reviewer`, never both by default.
4. Add `simplifier` only for a concrete structural question.
5. Write a concise assignment brief with task-specific focus and known evidence.
6. Spawn independent reviews in parallel only when there is more than one justified reviewer.
7. Reconcile findings, apply only actionable feedback, and run targeted validation.
8. Escalate from basic to expert only when concrete evidence meets an expert escalation condition.
9. Use no more than two review cycles; make the second targeted and final.

## Done Criteria

- Review depth matches the change's risk and reversibility.
- Basic and expert review were not redundantly combined.
- Specialist use was tied to a concrete concern.
- Each reviewer received the relevant outcome, scope, evidence, and task-specific focus.
- Parallel reviewers had distinct missions rather than duplicate generic prompts.
- No reviewer was launched solely to satisfy ceremony.
- Basic review was preferred whenever it was adequate; expert review had a stated escalation condition.
- Review stopped after no more than two cycles.
- Findings were verified and reconciled before completion was claimed.
