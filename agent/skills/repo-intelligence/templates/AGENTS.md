# Agent Guide

## Source-of-truth order

When documents disagree, resolve them in this order:

1. `CONTEXT.md` and local contexts for canonical language
2. current ADRs for durable decisions
3. `ARCHITECTURE.md` for synthesized current system shape
4. `ROADMAP.md` for medium-term sequencing
5. `docs/plans/` for temporary implementation state
6. `docs/guidelines/` for engineering standards
7. this file for agent/dev workflow rules

Do not let agent instructions invent domain concepts, architecture, or decisions that are missing from the owning docs.

## What goes where

| Fact type | Owner |
| --- | --- |
| durable shared language | root `CONTEXT.md` |
| local bounded-context language | local `CONTEXT.md` |
| context topology and translations | `CONTEXT-MAP.md` |
| durable hard-to-reverse decisions | ADRs |
| current architecture synthesis | `ARCHITECTURE.md` |
| medium-term sequencing | `ROADMAP.md` |
| temporary implementation plans/checklists | `docs/plans/` |
| engineering standards | `docs/guidelines/` |
| agent/dev workflow rules | `AGENTS.md` or equivalent |
| local enforcement-seam rationale | short code comment with ADR reference |

## Editing rules

- Update context files only for durable language a domain expert or subsystem owner would care about.
- Add or update ADRs only for decisions that are hard to reverse, surprising without context, and trade-off-backed.
- Keep `ARCHITECTURE.md` aligned with current ADRs and contexts; do not use it as a task list.
- Put temporary execution state in `docs/plans/`, not ADRs, context, or architecture docs.
- Keep `ROADMAP.md` focused on sequencing and direction, not low-level checklist state.
- Keep this file focused on how agents should work in this repo.

## Inline ADR references in code

Add a terse ADR comment near code only when the code enforces a non-obvious durable decision.

Good:

```ts
// ADR-0007: tenant isolation is enforced before query execution.
```

Avoid:

- long rationale copied from an ADR
- comments that merely narrate obvious code
- references to temporary plans as if they were durable architecture

## Before finishing material work

Check whether the change created a documentation delta:

- new or changed terminology?
- new or changed boundary/invariant?
- new durable decision?
- roadmap or implementation-plan status change?
- new engineering or agent workflow rule?
- new enforcement seam that deserves an ADR reference?

Update the owning file before claiming the work is complete.
