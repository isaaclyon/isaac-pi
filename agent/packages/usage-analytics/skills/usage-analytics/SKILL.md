---
name: usage-analytics
description: Query Pi usage analytics with `pi-usage-query`. Use when answering questions about skill invocations, tool usage, failures, slow tools, or repo-level usage trends.
disable-model-invocation: true
---

# Usage Analytics

Use the package CLI command `pi-usage-query` to answer questions about Pi usage analytics.

## What this package measures

- explicit `/skill:name` invocations from raw `input`
- observed skill loads from successful reads of registered skill files
- tool executions from `tool_execution_start` / `tool_execution_end`
- repo scope from `ctx.cwd` via git repo-root resolution

Observed skill loads mean the model read a registered skill file. They do **not** prove the skill influenced reasoning.

## Scope rules

- Analytics are local-only: the collector records and the CLI reports events from
  the Pi repository at `~/.pi`.
- `--scope=current` and `--scope=all` are both limited to `~/.pi`.
- A repo path may only resolve to `~/.pi`; other paths are rejected.

## Preferred query flow

1. Start with a canned report:
  - `summary`
  - `skills`
  - `skill-loads`
  - `tools`
   - `extension-tools`
   - `failures`
   - `slow-tools`
   - `repos`
2. Add filters as needed:
   - for canned reports only:
   - `--scope=current|all`
   - `--repo <path>`
   - `--days <n>`
   - `--limit <n>`
   - `--format json`
3. Only use `sql` when a canned report is not enough.

## Commands

```bash
pi-usage-query summary --scope=current
pi-usage-query skills --days=7
pi-usage-query skill-loads --days=7
pi-usage-query tools --limit=20
pi-usage-query extension-tools
pi-usage-query failures
pi-usage-query slow-tools --days=30
pi-usage-query repos
```

## SQL escape hatch

Use only read-only SQL. Stick to `SELECT` / `WITH` queries. SQL mode runs your query as written; canned-report flags are not applied for you.

```bash
pi-usage-query sql "SELECT skill_name, COUNT(*) AS n FROM skill_invocations GROUP BY skill_name ORDER BY n DESC LIMIT 10"
```

## Response guidance

- Lead with the answer.
- Mention scope and time filter used.
- Mention the caveat when skill counts are involved: `skills` counts only explicit `/skill:name` commands; `skill-loads` also includes observed successful reads of registered skill files, which is a proxy for implicit loads, not proof of semantic influence.
