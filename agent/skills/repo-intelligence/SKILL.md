---
name: repo-intelligence
description: "Discover, scaffold, and govern a repo's architecture/context/ADR system. Use when bootstrapping documentation for a new or existing repo, entering an unfamiliar subsystem, deciding where facts should live, or checking whether code/design changes require CONTEXT, ARCHITECTURE, guideline, or ADR updates."
---

# Repo Intelligence

Use this skill to establish and operate a repo's documentation intelligence layer: the files that define system shape, domain language, durable decisions, and engineering standards.

This skill is a **router and steward**, not the source of truth itself. The repo files own the facts; this skill owns discovery order, scaffolding, routing, and ratcheting.

## What this skill owns

- Discover where repo knowledge lives.
- Scaffold a minimal documentation system in a greenfield or partially-documented repo.
- Load the right docs before design or implementation work.
- Route into deeper skills such as `grill-with-docs` and `create-adr` when the task deserves them.
- Ask whether a code or design change created a documentation delta that now needs to be captured.

## Core rule

Do **not** turn this skill into a giant hidden prompt that silently owns repo knowledge.

Prefer an explicit repo contract with durable files such as:

- `ARCHITECTURE.md`
- `CONTEXT.md`
- `CONTEXT-MAP.md`
- `docs/adr/` or `docs/adrs/`
- `docs/guidelines/`
- package- or subsystem-local `CONTEXT.md`

The recommended contract is in [references/REPO-CONTRACT.md](references/REPO-CONTRACT.md).

## Modes

Choose one mode up front.

### 1. Bootstrap

Use when the repo is new, fragmented, or missing durable documentation.

Goal: leave behind a small, explicit system that future work can rely on.

Workflow:

1. Inspect what already exists before proposing anything.
   - Find `ARCHITECTURE.md`, `CONTEXT.md`, `CONTEXT-MAP.md`, ADR folders, guidelines, package READMEs, and agent instructions.
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
4. Scaffold only the missing surfaces.
   - Never overwrite the current owner of a fact without user approval.
   - If the repo already uses `docs/adrs/`, preserve it rather than renaming to `docs/adr/` just for purity.
5. Start from the templates in [templates/](templates/) and keep them minimal.
6. Record the one-owner-per-fact rule early so future docs do not overlap.
7. Verify links, file paths, and consistency of the chosen structure.

Bootstrap default file set:

- `ARCHITECTURE.md`
- root `CONTEXT.md` **or** root `CONTEXT-MAP.md`
- local `CONTEXT.md` files for important contexts when needed
- `docs/adr/README.md` and `docs/adr/template.md` (or `docs/adrs/` if the repo already uses that)
- `docs/guidelines/engineering-standards.md`
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
   - **doc obligations** — what docs might need updates if this task lands
4. Route to the right deeper workflow:
   - fuzzy terminology, contested boundaries, or plan stress-testing → `grill-with-docs`
   - hard-to-reverse decision with real trade-offs → `create-adr`
   - straightforward implementation → code/test while respecting the loaded contract
5. Before claiming completion, ask the doc-delta questions:
   - Did terminology change?
   - Did a boundary or invariant change?
   - Did we make a durable decision?
   - Did we introduce or tighten an engineering rule?

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

Ratchet by proposing the smallest durable improvement:

- add a missing index or context file
- tighten a guideline
- create an ADR
- clarify a translation in `CONTEXT-MAP.md`
- add a small structural check only after the docs shape is stable

## One-owner-per-fact rule

When scaffolding or repairing a doc system, assign one home per fact type.

Recommended default:

| Fact type | Owner |
| --- | --- |
| System shape, major boundaries, dependency map | `ARCHITECTURE.md` |
| Shared domain language and naming discipline | root `CONTEXT.md` |
| Multi-context topology and genuine translations | root `CONTEXT-MAP.md` |
| Package/subsystem-local technical dialect | local `CONTEXT.md` |
| Durable architectural decisions and their why | `docs/adr/` or `docs/adrs/` |
| Repo-wide engineering standards and quality bars | `docs/guidelines/` |
| Orientation and contributor entrypoints | `README.md` |
| Short agent-only gotchas and safety notes | `CLAUDE.md` or equivalent |

Do not duplicate the same fact across several layers unless one file is explicitly an index pointing to the owner.

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

## Escalation rules

Use `grill-with-docs` when:

- the user wants to stress-test a plan
- glossary terms are fuzzy or overloaded
- context boundaries are still unclear
- code and stated behavior seem to disagree

Use `create-adr` when all three are true:

1. the decision is hard to reverse
2. it will be surprising without context
3. it results from a real trade-off

## Done criteria

This skill has done its job when:

- the repo has a clear documentation contract or a clear path to one
- the current task is grounded in the right repo language and boundaries
- durable decisions are routed into ADRs when warranted
- doc deltas are captured in their owning files
- the documentation system got simpler or clearer, not more ceremonial
