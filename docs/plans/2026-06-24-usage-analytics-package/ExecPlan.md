# Package Pi usage analytics as an always-on collector plus an on-demand query skill

This ExecPlan is a living document. Update `Progress`, `Decision Log`, and `Outcomes` as implementation lands.

## Purpose / Big Picture

We want one installable Pi package that answers a simple user need: "tell me how Pi, its skills, and its extension tools are being used." The package should not depend on fragile prompt memory or session scraping. It should record durable usage facts as Pi runs, then let the user ask one skill invocation for canned views or ad hoc questions.

The package shape is intentionally split in two:

- an **always-on collector extension** records facts into a local SQLite database
- an **on-demand query skill** tells the agent how to inspect that database and answer usage questions

This keeps observation separate from explanation. The extension collects data without waiting for the model to remember to help; the skill gives the user one stable command surface for asking questions.

## Definition of Done

This work is complete when a package rooted at `agent/packages/usage-analytics/` exists and delivers:

- a package manifest that Pi can install from a local path or future git/npm source
- an always-on extension under `extensions/` that records:
  - explicit `/skill:name` invocations seen in the `input` event
  - tool execution facts from `tool_execution_start` / `tool_execution_end`
- repo-aware storage, where each fact is tagged with the resolved git repo root when one exists and `NULL` otherwise
- a SQLite database under Pi-owned local state, with append-only event tables plus SQL views for canned summaries
- a query CLI under the package that can print default reports and run read-only ad hoc `SELECT` queries
- a skill under `skills/usage-analytics/` that tells the agent how to use that CLI, including default scope rules (`current repo` vs `all repos`)
- at least these default views:
  - summary
  - skills
  - tools
  - extension-tools
  - failures
  - slow-tools
  - repos
  - current-repo variants where applicable
- focused tests for the non-Pi logic: repo-root resolution, read-only SQL guardrails, and canned query formatting

## Proposed package layout

```text
agent/packages/usage-analytics/
  package.json
  CONTEXT.md
  extensions/
    usage-tracker.ts
  skills/
    usage-analytics/
      SKILL.md
  scripts/
    usage-query.mjs
  src/
    db.mjs
    repo.mjs
    reports.mjs
    sql.mjs
  tests/
    repo.test.mjs
    sql.test.mjs
    reports.test.mjs
  docs/
    adr/
      README.md
      0001-split-collection-from-query.md
```

Package conventions come from Pi's package docs: use `extensions/` and `skills/` directories so the package can be installed directly without extra custom wiring.

## Data model

Store facts, not counters.

### `skill_invocations`

One row per explicit `/skill:name` command observed in raw input.

Suggested columns:

- `id`
- `ts`
- `session_file`
- `cwd`
- `repo_root`
- `skill_name`
- `raw_input`

### `tool_executions`

One row per completed tool execution.

Suggested columns:

- `id`
- `ts`
- `session_file`
- `cwd`
- `repo_root`
- `tool_call_id`
- `tool_name`
- `tool_source` (`extension` | `non_extension`)
- `tool_path`
- `ok`
- `duration_ms`

### Views

Views own the canned reports. Start with:

- `v_skill_counts`
- `v_tool_counts`
- `v_extension_tool_counts`
- `v_tool_failures`
- `v_tool_latency`
- `v_repo_counts`
- `v_repo_skill_counts`
- `v_repo_tool_counts`

## Runtime shape

### Collector extension

- On startup, ensure the SQLite file and schema exist.
- On `input`, count only explicit `/skill:name` invocations. Do **not** pretend to detect implicit model skill usage.
- On `tool_execution_start`, record start time in memory by `toolCallId`.
- On `tool_execution_end`, write one execution row with duration, success, tool provenance, cwd, session path, and repo root.
- Resolve repo root lazily from `ctx.cwd` via git; if git lookup fails, store `NULL`.

### Query CLI

The CLI is the stable query surface shared by the skill and direct terminal usage.

Suggested commands:

- `summary`
- `skills`
- `tools`
- `extension-tools`
- `failures`
- `slow-tools`
- `repos`
- `sql <select ...>`

Suggested filters:

- `--scope=current|all`
- `--repo <path>`
- `--days <n>`
- `--limit <n>`
- `--format=table|json`

For the read-only `sql` escape hatch, run the query as written; canned-report filters are not auto-applied.

### Query skill

The skill should:

- default to **current repo** when the user says "here", "this repo", or "current repo"
- default to **all repos** otherwise
- prefer canned CLI commands first
- use read-only SQL only when the canned views are insufficient
- report caveats plainly, especially that only explicit `/skill:name` invocations are counted

## Progress

- [x] (2026-06-24) Agreed on the product shape: always-on extension for collection, one skill invocation for querying.
- [x] (2026-06-24) Chose repo-aware aggregation as a first-class dimension.
- [x] (2026-06-24) Wrote the package-local context, ADR scaffold, and this plan.
- [x] (2026-06-24) Created the package manifest and directory structure.
- [x] (2026-06-24) Implemented schema bootstrap and SQLite helpers.
- [x] (2026-06-24) Implemented collector hooks.
- [x] (2026-06-24) Implemented query CLI with canned views.
- [x] (2026-06-24) Added the skill instructions.
- [x] (2026-06-24) Added focused tests.

## Decision Log

- Decision: package the feature as one Pi package with both an extension and a skill.
  Rationale: the user wants one installable surface, not loose files.
  Date/Author: 2026-06-24 / coding agent with user.

- Decision: collect append-only usage facts in SQLite and derive reports from SQL views.
  Rationale: querying facts stays flexible; precomputed counters paint us into a corner immediately.
  Date/Author: 2026-06-24 / coding agent with user.

- Decision: count only explicit `/skill:name` invocations.
  Rationale: Pi exposes raw skill commands reliably in `input`; implicit model skill use is not observable and should not be faked.
  Date/Author: 2026-06-24 / coding agent with user.

- Decision: scope every fact to `repo_root` when available.
  Rationale: repo filtering and cross-repo comparison are first-order user needs, and adding the dimension at write time is cheaper than reconstructing it later.
  Date/Author: 2026-06-24 / coding agent with user.

- Decision: the skill is a query UX, not the collector.
  Rationale: a skill can instruct and query; it cannot passively observe all tool calls unless an extension already records them.
  Date/Author: 2026-06-24 / coding agent with user.

## Open questions / Out of scope

- Resolved: store the SQLite file at `~/.pi/agent/state/usage-analytics/usage-analytics.sqlite` by default.
- Open: whether to capture provider/model/session metadata in v1 or skip it until a real question needs it.
- Out of scope: dashboards, charts, background sync, cross-machine identity reconciliation, and inferred implicit skill usage.

## Outcomes

Implemented the package at `agent/packages/usage-analytics/` with:

- `package.json` using Pi package conventions
- collector extension in `extensions/usage-tracker.ts`
- query skill in `skills/usage-analytics/SKILL.md`
- query CLI in `scripts/usage-query.mjs`
- SQLite schema, views, repo resolution, canned reports, and read-only SQL validation in `src/`
- focused `node:test` coverage for repo resolution, SQL guardrails, and report formatting
