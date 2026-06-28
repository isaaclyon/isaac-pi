---
name: grill-with-docs
description: Grilling session that challenges a plan against existing repo language, documented decisions, architecture, roadmap, and implementation state. Use when the user wants to stress-test a plan, sharpen terminology, or decide which documentation layer should own emerging facts.
---

# Grill With Docs

Use this skill as the conversational funnel for turning fuzzy plans into precise language, decisions, boundaries, and execution notes.

The goal is not to create more docs. The goal is to ask hard questions until each important fact has one clear owner.

## Core behavior

Interview the user relentlessly about every aspect of the plan until there is shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one by one.

For each question:

- ask one question at a time
- provide your recommended answer
- wait for feedback before continuing
- if code or existing docs can answer the question, inspect them instead of asking

## Load the repo contract first

Before grilling, inspect the repo's documentation surfaces:

- `CONTEXT.md`
- `CONTEXT-MAP.md`
- local `CONTEXT.md` files relevant to the topic
- `docs/adr/` or `docs/adrs/`
- `ARCHITECTURE.md`
- `ROADMAP.md`
- `docs/plans/`
- `docs/repo-contract.md` or equivalent explicit repo contract
- `docs/guidelines/`
- `AGENTS.md`, `CLAUDE.md`, or equivalent

If the repo uses `repo-intelligence`, follow its contract and templates. In particular, use the recommended source-of-truth map in [repo-intelligence's contract reference](../repo-intelligence/references/REPO-CONTRACT.md), respect any repo-specific `docs/repo-contract.md`, and start from [repo-intelligence templates](../repo-intelligence/templates/) when creating or updating docs.

If the repo has a `docs/repo-contract.md` or equivalent, treat it as the repo-specific override for routing exceptions. If the repo has no explicit contract, use this default routing:

| Emerging fact | Owner |
| --- | --- |
| durable shared language | root `CONTEXT.md` |
| local bounded-context language | local `CONTEXT.md` |
| context topology and translations | `CONTEXT-MAP.md` |
| durable hard-to-reverse decision | ADR |
| current architecture synthesis | `ARCHITECTURE.md` |
| medium-term sequencing | `ROADMAP.md` |
| temporary implementation state | `docs/plans/` |
| repo-wide engineering rule | `docs/guidelines/` |
| agent/dev workflow rule | `AGENTS.md` / `CLAUDE.md` |
| non-obvious enforcement-seam rationale | short code comment with ADR reference |

## Filing question

As facts emerge, repeatedly ask:

> Is this a term, a decision, an invariant, architecture synthesis, roadmap intent, temporary implementation step, engineering rule, agent instruction, or inline guardrail?

Then file it in the owning surface. Do not put a fact in a more durable layer just because that file is already open.

Use this durability ladder:

1. **Term** — durable language → context files
2. **Decision** — hard to reverse, surprising, trade-off-backed → ADR
3. **Architecture synthesis** — current shape implied by terms and ADRs → `ARCHITECTURE.md`
4. **Roadmap intent** — medium-term sequencing → `ROADMAP.md`
5. **Implementation plan** — temporary checklist/open questions → `docs/plans/`
6. **Engineering rule** — repo-wide quality/workflow expectation → `docs/guidelines/`
7. **Agent instruction** — how agents should work in the repo → `AGENTS.md` / `CLAUDE.md`
8. **Inline guardrail** — local code enforcement seam → terse ADR comment

When unsure, choose the least durable surface that still prevents knowledge loss.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with existing context language, call it out immediately.

Example:

> Your glossary defines "cancellation" as reversing an entire Order, but you seem to mean removing one line item. Which is it?

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term.

Example:

> You're saying "account" — do you mean the Customer or the User? Those are different things.

### Discuss concrete scenarios

Stress-test domain relationships with concrete scenarios. Invent edge cases that force precision around boundaries, lifecycle, ownership, and failure behavior.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it.

Example:

> Your code cancels entire Orders, but you just said partial cancellation is possible — which should be true?

### Update context files for resolved terms

When durable language is resolved, update the owning context file inline. Don't batch resolved terminology until the end.

Use [CONTEXT-FORMAT.md](./CONTEXT-FORMAT.md) for compact context formatting, or the `repo-intelligence` context templates when that skill is present.

Do not couple context files to implementation details. Only include terms meaningful to domain experts or subsystem owners.

### Offer ADRs sparingly

Only offer to create or update an ADR when all three are true:

1. **Hard to reverse** — the cost of changing your mind later is meaningful
2. **Surprising without context** — a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off** — there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Use [ADR-FORMAT.md](./ADR-FORMAT.md), the repo's existing ADR convention, or the `repo-intelligence` ADR templates.

### Route temporary state to implementation plans

If the conversation produces steps, migration order, checklists, owner/status, verification commands, or open questions, put them in `docs/plans/` rather than ADRs, context, or architecture docs.

Implementation plans are temporary. They should point back to durable sources, not become durable sources themselves.

### Route agent workflow rules to agent instructions

If the conversation creates a rule about how coding agents should work in the repo, update `AGENTS.md`, `CLAUDE.md`, or the repo's equivalent. Do not hide agent workflow in chat history or ADRs.

### Consider inline ADR references in code

When the plan affects an enforcement seam in code, ask whether a terse ADR reference belongs there.

Use inline comments only when the code enforces a non-obvious durable decision and the ADR explains why.

Good:

```ts
// ADR-0023: runtime calls must cross the host bridge; do not bypass with direct credentials.
```

Avoid copying ADR rationale into code.

## Completion check

Before ending the grilling session, summarize:

- resolved terminology and owning context files
- decisions made and whether ADRs were created/updated or intentionally skipped
- architecture synthesis changes, if any
- roadmap or implementation-plan updates, if any
- agent/guideline updates, if any
- code ADR-reference opportunities, if any
- remaining open questions and who must answer them
