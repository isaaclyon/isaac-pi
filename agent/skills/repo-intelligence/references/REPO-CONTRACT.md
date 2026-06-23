# Recommended Repo Contract

This reference describes the documentation contract that `repo-intelligence` prefers to discover or scaffold.

It is intentionally small. The goal is not more docs; the goal is **clear ownership**.

## Minimal surfaces

### `README.md`

Owns orientation:

- what this repo is
- how to get started
- where major subsystems live
- where deeper docs live

It should not become the canonical glossary, architecture decision log, or rulebook.

### `ARCHITECTURE.md`

Owns the high-level map:

- system purpose
- major components and boundaries
- dependency or data-flow shape
- stable invariants that future contributors must preserve
- links to deeper docs

### Root `CONTEXT.md`

Owns shared repo language:

- important business or product terms
- naming discipline
- cross-cutting concepts that appear in several modules

### Root `CONTEXT-MAP.md`

Owns multi-context topology:

- which contexts exist
- where each context's local glossary lives
- shared-kernel vs local-dialect boundaries
- genuine term translations between contexts

Use it when one root glossary is not enough.

### Local `CONTEXT.md`

Owns a package's or subsystem's local dialect:

- technical terms specific to that boundary
- local invariants
- translations from shared terms into local implementation vocabulary

### `docs/adr/` or `docs/adrs/`

Owns durable decisions:

- what was chosen
- why it was chosen
- what was rejected
- consequences worth preserving

Prefer `docs/adr/` when starting fresh, but preserve `docs/adrs/` if the repo already uses it coherently.

### `docs/guidelines/`

Owns repo-wide engineering standards:

- testing expectations
- typing expectations
- boundary-design rules
- simplicity or review rules
- language- or framework-specific practices when they are truly repo-wide

### `CLAUDE.md` or equivalent

Owns short agent-facing guidance only:

- safety-critical gotchas
- command surfaces
- quick pointers to the real owners above

It should not become the hidden source of truth for architecture or domain language.

## One owner per fact

Use this default mapping unless the repo already has a better explicit contract.

| Fact | Owner |
| --- | --- |
| Orientation | `README.md` |
| System map and boundaries | `ARCHITECTURE.md` |
| Shared language | root `CONTEXT.md` |
| Multi-context topology | root `CONTEXT-MAP.md` |
| Local technical dialect | local `CONTEXT.md` |
| Durable decision rationale | ADRs |
| Engineering rules | `docs/guidelines/` |
| Agent-only sharp edges | `CLAUDE.md` |

## Bootstrap decision tree

### New repo

Start with:

- `README.md`
- `ARCHITECTURE.md`
- root `CONTEXT.md`
- `docs/adr/README.md`
- `docs/adr/template.md`
- `docs/guidelines/engineering-standards.md`

Then add `CONTEXT-MAP.md` and local `CONTEXT.md` files if the repo grows into several bounded contexts.

### Existing repo

Start by inspecting first. Then choose the smallest repair:

- missing architecture map → add `ARCHITECTURE.md`
- duplicated glossary terms in many places → create or clarify `CONTEXT.md`
- several apps/packages with different dialects → add `CONTEXT-MAP.md` and local contexts
- repeated design arguments → start ADRs
- undocumented repo standards → add `docs/guidelines/engineering-standards.md`

## Ratchet ideas

Once the structure is in use, small guardrails become worthwhile:

- every top-level package has a local `CONTEXT.md`
- `CONTEXT-MAP.md` lists every context
- ADR numbering stays sequential
- required root docs exist
- repo-specific standards point to real checks where practical

Do not automate semantic agreement too early. First make the structure explicit and used.
