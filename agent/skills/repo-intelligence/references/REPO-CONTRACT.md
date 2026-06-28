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

It should not become the canonical glossary, architecture decision log, roadmap, or rulebook.

### `ARCHITECTURE.md`

Owns the current high-level map:

- system purpose
- major components and boundaries
- dependency or data-flow shape
- stable invariants that future contributors must preserve
- links to deeper docs and current ADRs

It should synthesize current decisions, not preserve implementation checklists or rejected historical paths as current truth.

### Root `CONTEXT.md`

Owns shared repo language:

- important business or product terms
- naming discipline
- cross-cutting concepts that appear in several modules

It should not contain implementation plans, API shapes, file layouts, or speculative features.

### Root `CONTEXT-MAP.md`

Owns multi-context topology:

- which contexts exist
- where each context's local glossary lives
- shared-kernel vs local-dialect boundaries
- genuine term translations between contexts

Use it when one root glossary is not enough. Do not duplicate glossary definitions there.

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

### `ROADMAP.md`

Owns medium-term direction:

- active themes or phases
- sequencing assumptions
- visible trade-offs that are not yet ADR-level decisions
- pointers to implementation plans when work is active

It should not become a stale task tracker or a substitute for ADRs.

### `docs/plans/`

Owns temporary implementation state:

- active work plans
- migration checklists
- verification steps
- open questions and cut lines
- follow-ups that should disappear once done

Plans are intentionally less durable than roadmap, architecture, context, and ADRs. Archive or delete completed plans according to repo convention.

### `docs/guidelines/`

Owns repo-wide engineering standards:

- testing expectations
- typing expectations
- boundary-design rules
- simplicity or review rules
- language- or framework-specific practices when they are truly repo-wide

### `AGENTS.md`, `CLAUDE.md`, or equivalent

Owns agent-facing workflow guidance:

- source-of-truth order
- safety-critical gotchas
- command surfaces
- doc-routing rules agents should apply
- quick pointers to the real owners above

It should not become the hidden source of truth for architecture or domain language.

### Code comments with ADR references

Own local enforcement-seam rationale:

- short comments near non-obvious code that enforces a durable ADR
- pointers such as `ADR-0023: host bridge boundary`

Do not copy ADR rationale into code comments.

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
| Medium-term sequencing | `ROADMAP.md` |
| Temporary implementation state | `docs/plans/` |
| Engineering rules | `docs/guidelines/` |
| Agent/dev workflow rules | `AGENTS.md` / `CLAUDE.md` |
| Local ADR enforcement rationale | code comment with ADR reference |

## Bootstrap decision tree

### New repo

Start with:

- `README.md`
- `ARCHITECTURE.md`
- root `CONTEXT.md`
- `docs/adr/README.md`
- `docs/adr/template.md`
- `docs/guidelines/engineering-standards.md`
- `AGENTS.md` or equivalent if coding agents need repo-specific rules

Then add:

- `CONTEXT-MAP.md` and local `CONTEXT.md` files if the repo grows into several bounded contexts
- `ROADMAP.md` when medium-term sequencing becomes valuable
- `docs/plans/` when active implementation work needs temporary written state

### Existing repo

Start by inspecting first. Then choose the smallest repair:

- missing architecture map → add `ARCHITECTURE.md`
- duplicated glossary terms in many places → create or clarify `CONTEXT.md`
- several apps/packages with different dialects → add `CONTEXT-MAP.md` and local contexts
- repeated design arguments → start ADRs
- active implementation details scattered through durable docs → move them to `docs/plans/`
- undocumented roadmap themes → add or repair `ROADMAP.md`
- undocumented repo standards → add `docs/guidelines/engineering-standards.md`
- agent-only gotchas hiding in prompts or chat history → add `AGENTS.md` or equivalent

## Ratchet ideas

Once the structure is in use, small guardrails become worthwhile:

- every top-level package has a local `CONTEXT.md`
- `CONTEXT-MAP.md` lists every context
- ADR numbering stays sequential
- required root docs exist
- implementation plans have owners, status, verification steps, and completion/archival rules
- repo-specific standards point to real checks where practical
- high-value code enforcement seams reference the owning ADR

Do not automate semantic agreement too early. First make the structure explicit and used.
