# Atomic Specs for ExecPlan Folders

This document defines how to create and maintain plan folders that combine one high-level ExecPlan with a set of short, atomic implementation specs. It complements `.agent/PLANS.md`; it does not replace it. The ExecPlan remains the source of truth for the end-to-end feature and must still follow `.agent/PLANS.md`.

## Purpose

Use this method when a feature is too large or nuanced for one flat plan, especially when several independently testable slices must still add up to one real user-facing capability. The ExecPlan keeps the forest visible: why the feature matters, how specs sequence together, and what definition of done proves the integrated feature works. Atomic specs keep the trees small: each spec states one goal, concrete constraints, hard tests, and a todo list.

A plan folder prevents the common failure mode where every narrow ticket passes but the final feature is not useful. Completing all specs is necessary but not sufficient; the ExecPlan's definition of done must also be satisfied. The plan must always include an explicit integration proof showing that the feature works across the real boundary a user or downstream system depends on.

## Required Location and Naming

All new multi-spec plans must live under `docs/plans/` as a folder:

    docs/plans/YYYY-MM-DD-short-slug/

Use the current date and a lowercase hyphenated slug. The folder must contain one high-level ExecPlan and one or more atomic specs:

    docs/plans/2026-05-21-contribution-profit-ltv/
      ExecPlan.md
      spec-01-ltv-spine.md
      spec-02-economic-order-periodization.md
      spec-03-period-cp-measures.md

Use stable numeric prefixes for specs. Do not renumber existing specs after work begins unless the plan explicitly records why the ordering changed.

Existing single-file plans in `docs/plans/*.md` do not need to be migrated just because this guide exists. If a single-file plan is actively reworked into multiple specs, migrate it into a folder and keep its history in the new `ExecPlan.md` revision notes.

## ExecPlan.md Requirements

`ExecPlan.md` is the high-level plan. It must follow `.agent/PLANS.md` and remain self-contained enough for a novice to understand and complete the feature. In addition to the standard ExecPlan sections, it should include these sections near the top:

    ## Definition of Done

    ## Spec Sequence

`Definition of Done` describes the integrated behavior that proves the whole feature is real. It must not merely say that every spec is complete. It should answer: what can a user do after this ships, what command or UI confirms it, what data ties out, what integration test or end-to-end scenario proves the whole path works, and what remaining risks are acceptable?

`Spec Sequence` lists each spec file in the intended implementation order and explains why that order matters. If specs can run in parallel, say so and explain the boundaries. If later specs depend on validation from earlier specs, state that dependency plainly.

A recommended `ExecPlan.md` outline is:

    # <Feature title>

    This ExecPlan is a living document. The sections `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` must be kept up to date as work proceeds. This document follows `.agent/PLANS.md` and uses atomic specs as defined in `.agent/SPECS.md`.

    ## Purpose / Big Picture

    ## Definition of Done

    ## Spec Sequence

    ## Progress

    ## Surprises & Discoveries

    ## Decision Log

    ## Outcomes & Retrospective

    ## Context and Orientation

    ## Plan of Work

    ## Validation and Acceptance

    ## Idempotence and Recovery

    ## Artifacts and Notes

    ## Interfaces and Dependencies

    ## Revision Notes

The ExecPlan should not duplicate every line of every spec. It should connect the specs, name the global constraints, and preserve enough context that a contributor understands why each atomic spec exists.

## Atomic Spec Requirements

Each atomic spec is a short Markdown file. It should be independently implementable and independently testable, but it does not need to repeat all context from `ExecPlan.md`. When a spec uses domain terms, define them briefly or point to the section in `ExecPlan.md` that defines them.

Every spec must use exactly these top-level sections:

    # Spec NN: <Short title>

    ## Goal

    ## Must do

    ## Constraints / Must not do

    ## Acceptance Criteria

    ## Tests

    ## Todo

`Goal` explains the specific outcome of this spec in one or two short paragraphs. It should say what exists after the spec that did not exist before.

`Must do` lists the concrete implementation requirements. Name files, models, commands, fields, or interfaces. Prefer precise bullets over broad intent.

`Constraints / Must not do` states boundaries. Include things that must remain unchanged, risky shortcuts to avoid, and contracts that downstream users rely on.

`Acceptance Criteria` describes qualitative and quantitative outcomes a human can verify. This is broader than tests. Include row counts, tie-outs, visible UI labels, documented behavior, or expected output shapes where relevant.

`Tests` lists hard pass/fail checks. Include unit tests, dbt tests, data tests, parse checks, type checks, command lines, and—where this spec is responsible for end-to-end proof—integration tests. State the expected result, such as zero rows from a singular dbt test or `PASS=... ERROR=0` from a focused build.

`Todo` is a checkbox list for implementation. Keep it concrete enough that a future agent can resume work without guessing.

A recommended spec skeleton is:

    # Spec 01: Build the LTV period spine

    ## Goal

    Create the base model at the target grain and prove it preserves the existing revenue LTV rows.

    ## Must do

    - Create `path/to/model.sql`.
    - Preserve one row per `customer_id + geography_code + period_number`.
    - Carry these fields unchanged: ...

    ## Constraints / Must not do

    - Do not change the existing revenue LTV mart.
    - Do not include pre-2025 cohorts in version 1.

    ## Acceptance Criteria

    - New row count equals the source spine row count for the scoped cohorts.
    - Revenue fields match within 0.01.

    ## Tests

    - `dbt build --select model_name test_name --target dev-sf` passes.
    - `test_name` returns zero rows.

    ## Todo

    - [ ] Create SQL model.
    - [ ] Add YAML tests.
    - [ ] Run focused dbt build.
    - [ ] Record validation evidence in `ExecPlan.md`.

## Acceptance Criteria vs Tests

Acceptance criteria and tests are intentionally different.

Acceptance criteria are about user-visible or stakeholder-visible truth. They may include examples like: Finance can build a cohort curve by period number; a new Lightdash explore has unambiguous labels; a prod tie-out matches direct Snowflake aggregation; or a model exposes a cost breakdown that explains a margin change.

Tests are hard gates that automation can pass or fail. They include dbt unique/not-null tests, singular data tests, unit tests, type checks, parse checks, exact commands, and integration scenarios. A spec should have both. For every feature-sized plan, at least one spec must define an integration or end-to-end test that proves the full intended workflow across real components, not just mocked or isolated units. If the work is small enough that one atomic spec already provides that proof, call that out explicitly. If a behavior cannot be fully automated, include the closest automated integration test plus a manual acceptance check.

## Writing Good Atomic Specs

Keep each spec small enough that it can be completed and validated in one focused pass. A good spec changes one layer or contract at a time: create a spine, add period measures, add cumulative measures, add metadata, or validate rollout. If a spec needs many unrelated tests or touches many unrelated areas, split it.

Prefer explicit source-of-truth language. For example, say "source revenue fields from `agg_customer_ltv_periods_d2c` and compare within 0.01" rather than "make revenue accurate." Say "valid non-revenue D2C orders means `fct_shopify_orders.is_valid_order = true` and `is_revenue_order = false`" rather than "include non-revenue orders."

Do not use specs to hide unresolved product questions. If the right behavior is ambiguous, record the decision in `ExecPlan.md` or ask the user before writing final acceptance criteria.

## Workflow

When asked to create specs for a feature:

1. Read the real repository state before writing. Inspect relevant files, tests, docs, and production data if the user asks for production validation.
2. Decide whether the feature needs a multi-spec folder. Use this method for non-trivial features, data model changes, cross-cutting refactors, or anything with multiple independently testable slices.
3. Create `docs/plans/YYYY-MM-DD-slug/ExecPlan.md` first. Include purpose, definition of done, spec sequence, global decisions, and validation approach.
4. Create one `spec-NN-slug.md` file per atomic slice.
5. Cross-check that each spec has hard tests and acceptance criteria.
6. Cross-check that the plan includes explicit integration coverage. Prefer a dedicated integration-validation spec when the feature spans multiple layers or contracts; otherwise, explicitly identify the atomic spec that provides the end-to-end proof.
7. Cross-check that the ExecPlan's definition of done proves the integrated feature, not just the specs.
8. Ask a `reviewer` subagent to pressure-test the completed plan folder before calling it ready. The reviewer should be read-only and should check for unclear terms, missing implementation context, missing tests, missing integration coverage, weak acceptance criteria, sequencing gaps, and cases where completing specs would not actually ship the intended feature. Incorporate the review feedback or explicitly record why it was not adopted.
9. Commit the completed plan folder and any planning-guidance changes before implementation begins. This creates a safe checkpoint that can be reverted if implementation goes in the wrong direction. Use a focused commit message such as `spec contribution profit ltv` or `add create-specs planning guidance`.
10. Keep `ExecPlan.md` updated during implementation. Record discoveries and decisions there. Update spec todo lists as each atomic spec progresses.

## Completion Checklist

Before calling a plan folder ready for implementation, verify:

- `ExecPlan.md` follows `.agent/PLANS.md` and includes `Definition of Done` and `Spec Sequence`.
- Every spec has the six required sections.
- Every spec names concrete files or models to create or edit.
- Every spec includes hard pass/fail tests.
- The plan includes explicit integration-test coverage, either as a dedicated spec or a clearly identified atomic spec that proves the real end-to-end flow.
- The specs are sequenced or explicitly marked parallel-safe.
- The ExecPlan explains how all specs combine into a real user-facing outcome and names the final integration proof.
- The plan folder lives under `docs/plans/YYYY-MM-DD-slug/`.
- A read-only `reviewer` subagent has pressure-tested the plan folder, and its feedback has been incorporated or consciously rejected with rationale.
- The plan folder has been committed as a checkpoint before implementation begins.

Before calling the feature complete, verify:

- All spec todos are complete or explicitly deferred with rationale.
- All spec tests pass in the required environment.
- The required integration or end-to-end proof has been executed successfully and captured as evidence.
- The ExecPlan definition of done is satisfied.
- `Progress`, `Surprises & Discoveries`, `Decision Log`, and `Outcomes & Retrospective` are current.
- Evidence is recorded in `ExecPlan.md` or the relevant spec files.
