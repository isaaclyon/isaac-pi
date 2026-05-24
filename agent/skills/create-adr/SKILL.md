---
name: create-adr
description: "Create or update Architecture Decision Records. Use when the user asks to write an ADR, record an architectural decision, document a rejected approach, capture durable project constraints, or supersede/revisit an existing decision."
---

# Create ADR Skill

Use this skill to create or update Architecture Decision Records (ADRs) that preserve the reasoning behind durable project decisions.

## Purpose

ADRs should explain **what was decided and why**. Prefer short, useful records over ceremony. A one-paragraph ADR is often enough.

Use the project vocabulary from `CONTEXT.md` when it exists. If the decision introduces a durable domain term that is missing from `CONTEXT.md`, ask whether to add it there as part of the same work.

## When to Create an ADR

Create or offer an ADR only when the decision is:

1. **Hard to reverse** — changing it later would be meaningfully expensive.
2. **Surprising without context** — a future maintainer may wonder why the code is shaped this way.
3. **A real trade-off** — there were credible alternatives and one was chosen for specific reasons.

Good ADR topics include:

- Architectural shape and module seams.
- Integration patterns between subsystems.
- Technology choices with meaningful lock-in.
- Ownership, scope, and explicit non-goals.
- Deliberate deviations from the obvious path.
- Constraints not visible in code.
- Rejected alternatives that future maintainers are likely to suggest again.

Skip ADRs for decisions that are easy to reverse, self-evident, or purely tactical.

## Location and Numbering

ADRs live in:

```text
docs/adr/
```

Create the directory lazily if it does not exist.

Use sequential filenames:

```text
0001-short-slug.md
0002-short-slug.md
```

Before creating a new ADR:

1. Inspect `docs/adr/` if it exists.
2. Find the highest numeric prefix.
3. Increment it by one.
4. Use a lowercase hyphenated slug from the ADR title.

## Workflow

1. **Inspect existing records**
   - Read `CONTEXT.md` if present.
   - Read relevant ADRs in `docs/adr/` if present.
   - Avoid relitigating existing accepted ADRs unless the user explicitly wants to revisit them.

2. **Clarify the decision if needed**
   - Ask only for missing information that affects the ADR: decision, status, context, alternatives, or consequences.
   - Do not ask for ceremony if a concise ADR can be written from the conversation.

3. **Choose the format**
   - Start from [ADR-FORMAT.md](ADR-FORMAT.md).
   - Keep the ADR short by default.
   - Add optional sections only when they carry useful future context.

4. **Write or update the ADR**
   - New decisions get a new numbered file.
   - Superseded decisions should usually be updated in place to point to the new ADR.
   - If updating status, preserve the original decision text unless the user asks for a rewrite.

5. **Verify**
   - Confirm the file path.
   - Confirm numbering is correct.
   - Confirm links to related ADRs are valid when used.

## Status Values

Use lowercase status in frontmatter when status matters:

```yaml
---
status: accepted
---
```

Common statuses:

- `proposed` — under discussion.
- `accepted` — current decision.
- `deprecated` — no longer recommended, but not replaced by one specific ADR.
- `superseded by ADR-NNNN` — replaced by a newer ADR.

Omit status frontmatter when it adds no value.

## Style

- Be concrete: name the chosen path and the rejected alternatives.
- Explain trade-offs, not just conclusions.
- Prefer project language over generic architecture labels.
- Do not over-template. The ADR exists to preserve reasoning, not fill sections.
- Keep implementation details out unless they are part of the decision.
