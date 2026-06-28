---
name: repo-intelligence
description: "Discover, scaffold, and govern a repo's architecture/context/ADR/planning system. Use when bootstrapping documentation, entering an unfamiliar subsystem, deciding where facts should live, or checking whether code/design changes require CONTEXT, ARCHITECTURE, ADR, roadmap, plan, guideline, or AGENTS updates."
---

# Repo Intelligence

Use this skill to establish and operate a repo's documentation intelligence layer: the files that define system shape, domain language, durable decisions, temporary execution state, and engineering standards.

This skill is a **router and steward**, not the source of truth itself. The repo files own the facts; this skill owns discovery order, scaffolding, routing, and ratcheting.

## What this skill owns

- Discover where repo knowledge lives.
- Scaffold a minimal documentation system in a greenfield or partially-documented repo.
- Load the right docs before design or implementation work.
- Route into deeper skills such as `grill-with-docs` and `create-adr` when the task deserves them.
- Decide which documentation surface owns a new or changed fact.
- Ask whether a code or design change created a documentation delta that now needs to be captured.

## Core rule

Do **not** turn this skill into a giant hidden prompt that silently owns repo knowledge.

Prefer an explicit repo contract with durable files such as:

- `ARCHITECTURE.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `docs/adr/` or `docs/adrs/`
- `ROADMAP.md`
- `docs/plans/`
- `docs/guidelines/`
- `AGENTS.md`, `CLAUDE.md`, or equivalent agent instructions
- package- or subsystem-local `CONTEXT.md`

The recommended contract is in [references/REPO-CONTRACT.md](references/REPO-CONTRACT.md).

## What goes where

Route each fact to exactly one owning surface.

| Fact type | Owner |
| --- | --- |
| Orientation and contributor entrypoints | `README.md` |
| System shape, major boundaries, dependency/data-flow map | `ARCHITECTURE.md` |
| Shared domain language and naming discipline | root `CONTEXT.md` |
| Multi-context topology and genuine translations | root `CONTEXT-MAP.md` |
| Package/subsystem-local technical dialect | local `CONTEXT.md` |
| Durable architectural decisions and their why | `docs/adr/` or `docs/adrs/` |
| Medium-term sequencing and active product/engineering direction | `ROADMAP.md` |
| Temporary implementation state, checklists, migration steps, open questions | `docs/plans/` |
| Repo-wide engineering standards and quality bars | `docs/guidelines/` |
| Agent/dev workflow rules and safety notes | `AGENTS.md`, `CLAUDE.md`, or equivalent |
| Local rationale at an enforcement seam | a short code comment that references the relevant ADR |

Do not duplicate the same fact across several layers unless one file is explicitly an index pointing to the owner.

## Durability ladder

Use this ladder when deciding where a statement belongs:

1. **Term** — durable domain or local language → `CONTEXT.md` / `CONTEXT-MAP.md`
2. **Decision** — hard to reverse, surprising, trade-off-backed → ADR
3. **Architecture synthesis** — current shape implied by terms and current ADRs → `ARCHITECTURE.md`
4. **Roadmap intent** — medium-term sequencing, may change as work lands → `ROADMAP.md`
5. **Implementation plan** — temporary execution notes and verification checklist → `docs/plans/`
6. **Engineering rule** — repo-wide workflow or quality expectation → `docs/guidelines/`
7. **Agent instruction** — how coding agents should behave in this repo → `AGENTS.md` / `CLAUDE.md`
8. **Inline guardrail** — terse code rationale at a non-obvious enforcement seam → code comment with ADR reference

When unsure, choose the least durable surface that still prevents knowledge loss.

## Modes

Choose one mode up front.

### 1. Bootstrap

Use when the repo is new, fragmented, or missing durable documentation.

Goal: leave behind a small, explicit system that future work can rely on.

Workflow:

1. Inspect what already exists before proposing anything.
   - Find `README.md`, `ARCHITECTURE.md`, `CONTEXT.md`, `CONTEXT-MAP.md`, ADR folders, `ROADMAP.md`, `docs/plans/`, guidelines, package READMEs, and agent instructions.
   - Detect languages, package/app boundaries, and test/type tooling from the repo itself.
2. Decide whether the repo is **single-context** or **multi-context**.
   - Single-context: one root `CONTEXT.md` may be enough.
   - Multi-context: create root `CONTEXT-MAP.md` plus local `CONTEXT.md` files per bounded context.
3. Ask targeted questions only where the code cannot answer.
   - system purpose
   - context boundaries
   - naming preferences
   - testing/typing standards
   - ADR policy or existing conventions
   - planning surface expectations
   - agent instruction expectations
4. Scaffold only the missing surfaces.
   - Never overwrite the current owner of a fact without user approval.
   - If the repo already uses `docs/adrs/`, preserve it rather than renaming to `docs/adr/` just for purity.
   - If the repo already uses another agent instruction file, preserve it rather than creating `AGENTS.md` only for preference.
5. Start from the templates in [templates/](templates/) and keep them minimal.
6. Record the one-owner-per-fact rule early so future docs do not overlap.
7. Verify links, file paths, and consistency of the chosen structure.

Bootstrap default file set:

- `ARCHITECTURE.md`
- root `CONTEXT.md` **or** root `CONTEXT-MAP.md`
- local `CONTEXT.md` files for important contexts when needed
- `docs/adr/README.md` and `docs/adr/template.md` (or `docs/adrs/` if the repo already uses that)
- `ROADMAP.md` when medium-term sequencing is active
- `docs/plans/` when implementation plans are needed
- `docs/guidelines/engineering-standards.md`
- `AGENTS.md` or equivalent when agents need repo-specific workflow/safety rules
- optionally `docs/repo-contract.md` when the repo uses a nonstandard layout or has special routing rules worth making explicit

When bootstrapping an existing repo, be conservative:

- patch, don't rewrite
- fill gaps lazily
- preserve good existing docs
- prefer adding an index or contract over duplicating content

### 2. Operate

Use for normal design and implementation work.

Goal: build a task-specific working contract before changing code.

Workflow:

1. Discover the relevant repo surfaces for this task.
2. Read only the relevant files, not the whole repo by default.
3. Extract a short working contract:
   - **terms** — what words mean here
   - **boundaries** — what may depend on or call what
   - **invariants** — what must stay true
   - **quality rules** — tests, typing, coverage, boundary design rules
   - **execution state** — active roadmap items or implementation plans that constrain the task
   - **doc obligations** — what docs might need updates if this task lands
4. Route to the right deeper workflow:
   - fuzzy terminology, contested boundaries, or plan stress-testing → `grill-with-docs`
   - hard-to-reverse decision with real trade-offs → `create-adr`
   - straightforward implementation → code/test while respecting the loaded contract
5. Before claiming completion, ask the doc-delta questions:
   - Did terminology change?
   - Did a boundary or invariant change?
   - Did we make a durable decision?
   - Did roadmap sequencing or temporary implementation state change?
   - Did we introduce or tighten an engineering rule?
   - Did we introduce an agent/dev workflow convention?
   - Did code gain a non-obvious enforcement seam that deserves a terse ADR reference?

If yes, update the owning documentation surface instead of stuffing the explanation into code comments or agent notes.

### 3. Ratchet

Use after bootstrap or during periodic repo hygiene work.

Goal: keep the documentation intelligence layer trustworthy.

Look for:

- new packages or subsystems without a local `CONTEXT.md`
- repos that became multi-context but still pretend to be single-context
- repeated design arguments that should have become ADRs
- standards documented in prose but not reflected in tooling or review habits
- stale architecture docs after package moves or boundary changes
- glossary drift where the same term means different things in different places
- ADRs that contain temporary implementation checklists better suited to `docs/plans/`
- context or architecture docs that contain roadmap/plan status
- AGENTS/CLAUDE files that became hidden sources of domain or architecture truth
- code comments that explain durable architectural choices without linking to the owning ADR

Ratchet by proposing the smallest durable improvement:

- add a missing index or context file
- tighten a guideline
- create an ADR
- clarify a translation in `CONTEXT-MAP.md`
- move tactical notes into `docs/plans/`
- add or trim agent instructions so they point to the real source of truth
- add a short ADR reference at a high-value code enforcement seam
- add a small structural check only after the docs shape is stable

## Inline ADR references in code

Use code comments sparingly. Add an inline ADR reference only when all are true:

1. the code is an enforcement seam for a durable architectural decision
2. the local behavior is non-obvious or likely to be "cleaned up" incorrectly
3. the ADR explains why the code is constrained this way

Keep the comment short and local:

```ts
// ADR-0023: runtime calls must cross the host bridge; do not bypass with direct credentials.
```

Do not paste ADR rationale into code. If the rationale needs more than one short sentence, fix or add the ADR instead.

## When to scaffold which root context files

- Use only root `CONTEXT.md` when the repo has one dominant context and no strong bounded-context split.
- Add root `CONTEXT-MAP.md` when the repo has several bounded contexts, packages, apps, services, or product surfaces with different local dialects.
- In a multi-context repo, root `CONTEXT.md` should usually hold shared language while `CONTEXT-MAP.md` explains the topology.

## Engineering-standards guidance

Do not hardcode your personal favorite rules unless the user wants that.

Instead, extract or confirm the repo's actual standards, then capture them explicitly. Common examples:

- coverage expectations such as 90–95% or ratcheted 100%
- strict typing expectations
- parser-boundary rules such as parse-don't-validate
- TDD or regression-first bug-fix workflow
- simplicity / anti-overengineering preferences
- review expectations for material changes

Use [templates/engineering-standards.md](templates/engineering-standards.md) as a starting point, then tailor it.

## Existing-repo policy

When the repo already has some documentation, prefer **reconciliation** over replacement.

- Find the current owner of each fact.
- Preserve existing folder names and conventions when they are coherent.
- If two docs overlap, decide which one should own the fact and turn the other into a pointer or trim it.
- Avoid large rewrites unless the user asks for a full documentation architecture migration.
- Prefer moving content to the right layer over deleting it when it still has value.

## Escalation rules

Use `grill-with-docs` when:

- the user wants to stress-test a plan
- glossary terms are fuzzy or overloaded
- context boundaries are still unclear
- code and stated behavior seem to disagree
- a proposed change could land in several documentation layers and needs interrogation before filing

Use `create-adr` when all three are true:

1. the decision is hard to reverse
2. it will be surprising without context
3. it results from a real trade-off

## Templates

Start from these files and tailor them to the repo:

- [templates/ARCHITECTURE.md](templates/ARCHITECTURE.md)
- [templates/root-CONTEXT.md](templates/root-CONTEXT.md)
- [templates/CONTEXT-MAP.md](templates/CONTEXT-MAP.md)
- [templates/package-CONTEXT.md](templates/package-CONTEXT.md)
- [templates/adr-README.md](templates/adr-README.md)
- [templates/adr-template.md](templates/adr-template.md)
- [templates/ROADMAP.md](templates/ROADMAP.md)
- [templates/implementation-plan.md](templates/implementation-plan.md)
- [templates/AGENTS.md](templates/AGENTS.md)
- [templates/engineering-standards.md](templates/engineering-standards.md)
- [templates/repo-contract.md](templates/repo-contract.md)

## Done criteria

This skill has done its job when:

- the repo has a clear documentation contract or a clear path to one
- the current task is grounded in the right repo language and boundaries
- durable decisions are routed into ADRs when warranted
- temporary execution state is routed into roadmap or implementation-plan surfaces
- agent/dev workflow rules are routed into agent instructions instead of hidden prompts
- doc deltas are captured in their owning files
- the documentation system got simpler or clearer, not more ceremonial
