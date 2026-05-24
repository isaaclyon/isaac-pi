# ADR Format

ADRs live in `docs/adr/` and use sequential numbering: `0001-slug.md`, `0002-slug.md`, etc.

Create `docs/adr/` lazily — only when the first ADR is needed.

## Minimal Template

Use this by default.

```md
# {Short title of the decision}

{1-3 sentences: what situation forced the decision, what was decided, and why.}
```

## Status Template

Use frontmatter when the ADR status matters.

```md
---
status: accepted
---

# {Short title of the decision}

{1-3 sentences: what situation forced the decision, what was decided, and why.}
```

Status values:

- `proposed`
- `accepted`
- `deprecated`
- `superseded by ADR-NNNN`

## Expanded Template

Use this only when the extra sections preserve useful future context.

```md
---
status: accepted
---

# {Short title of the decision}

## Context

{What situation, constraint, or trade-off forced this decision? Include project vocabulary from CONTEXT.md when available.}

## Decision

{What are we choosing? Be specific enough that future work can follow it.}

## Considered Options

- {Option A}: {why it was accepted or rejected}
- {Option B}: {why it was accepted or rejected}

## Consequences

- {What gets easier?}
- {What gets harder or constrained?}
- {What future work should know?}
```

## Rejected Alternative Template

Use this when the main value is preventing a future maintainer from re-suggesting a non-obvious rejected path.

```md
# Do not {rejected approach}

We considered {rejected approach} for {situation}. We decided not to use it because {reason}. Instead, {chosen approach or constraint}.
```

## Superseding Template

When a new ADR replaces an old one, create the new ADR and update the old ADR status.

New ADR:

```md
---
status: accepted
supersedes: ADR-NNNN
---

# {New decision title}

{What changed, what decision replaces the older one, and why.}
```

Old ADR:

```md
---
status: superseded by ADR-NNNN
---

# {Original decision title}

{Preserve the original decision text unless explicitly asked to rewrite it.}
```

## Numbering Checklist

1. List existing files in `docs/adr/`.
2. Find the highest four-digit prefix.
3. Add one.
4. Write the new file as `{next-number}-{slug}.md`.

Example:

```text
docs/adr/0007-use-vcc-instead-of-lcm.md
```
