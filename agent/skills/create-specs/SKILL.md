---
name: create-specs
description: "Create plan folders with a high-level ExecPlan plus short atomic spec files. Use when the user asks to spec, plan, break down, or turn a feature into implementation-ready specs."
---

# Create Specs

Use this skill when the user asks to create, refine, or convert feature work into implementation specs. The output is a plan folder under `docs/plans/YYYY-MM-DD-slug/` containing one `ExecPlan.md` and one or more `spec-NN-slug.md` files.

## Source of Truth

This skill is self-contained. Before writing specs, read the guidance files that live beside this `SKILL.md`:

- `SPECS.md` for plan-folder and atomic-spec structure.
- `PLANS.md` for ExecPlan requirements.

Resolve these paths relative to the skill directory, not the target repository. If the target repository also has `.agent/SPECS.md` or `.agent/PLANS.md`, read those too and treat them as project-specific overrides. If they conflict with the self-contained guidance, prefer the project-specific files and record the decision in `ExecPlan.md`.

## Required Output

Create this shape:

    docs/plans/YYYY-MM-DD-short-slug/
      ExecPlan.md
      spec-01-short-slice.md
      spec-02-next-slice.md

`ExecPlan.md` is the forest. It explains the user-visible purpose, definition of done, spec sequence, global context, decisions, and end-to-end validation. It must also name the concrete integration proof that demonstrates the full feature works in a realistic end-to-end flow, not merely that isolated components pass.

Each `spec-*.md` file is a tree. It must be short and include exactly these top-level sections:

    # Spec NN: <Short title>

    ## Goal

    ## Must do

    ## Constraints / Must not do

    ## Acceptance Criteria

    ## Tests

    ## Todo

## Workflow

1. Inspect the real repository state first. Read relevant models, tests, docs, runtime commands, and production evidence when requested.
2. Identify the integrated feature outcome. Write it as the ExecPlan definition of done before splitting specs.
3. Split work into atomic, independently testable specs. Each spec should change one layer or contract at a time.
4. For every spec, include hard pass/fail tests and qualitative/quantitative acceptance criteria.
5. Require at least one explicit integration-test spec unless the work is so small that a single atomic spec already contains a genuine end-to-end proof. This integration coverage must exercise the real feature boundary across components, layers, or interfaces and must state the exact command, scenario, or fixture that proves the feature works as intended.
6. Ensure completing all specs is not the only definition of done. The ExecPlan must state how to prove the real feature works end to end, and that proof must be stronger than a collection of unit tests.
7. If converting an existing single-file plan, migrate it into the folder format and preserve important decisions, discoveries, and evidence in `ExecPlan.md`.
8. Before calling the spec folder ready, invoke a read-only `reviewer` subagent to pressure-test `ExecPlan.md` and the spec files. Ask it to look for missing context, weak acceptance criteria, missing tests, missing integration coverage, sequencing problems, and cases where the specs could pass without shipping the real feature. Incorporate the feedback or record why you are not taking it.
9. Commit the completed plan/spec folder and any planning-guidance changes before implementation begins. This checkpoint should be easy to revert to if implementation goes off track.

## Quality Bar

A spec folder is ready only when:

- the folder lives under `docs/plans/YYYY-MM-DD-slug/`;
- `ExecPlan.md` follows `.agent/PLANS.md` and includes `Definition of Done` plus `Spec Sequence`;
- every spec has the six required sections;
- every spec names concrete files, models, commands, or interfaces;
- every spec has hard tests with expected pass/fail outcomes;
- the plan includes explicit integration-test coverage that proves the feature across real boundaries, either in a dedicated integration spec or in a clearly identified atomic spec that performs true end-to-end validation;
- the ExecPlan explains how the specs combine into a useful shipped feature and names the final integrated proof;
- a `reviewer` subagent has pressure-tested the plan folder, with feedback incorporated or explicitly declined;
- the completed plan/spec folder has been committed as a checkpoint.

Avoid vague specs. Replace phrases like "make it accurate" with source-of-truth rules, tolerances, commands, and expected outputs.
