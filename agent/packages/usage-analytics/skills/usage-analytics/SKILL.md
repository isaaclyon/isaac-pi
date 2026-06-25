---
name: usage-analytics
description: Query Pi usage analytics with `pi-usage-query`. Use when answering questions about skill invocations, tool usage, failures, slow tools, or repo-level usage trends.
---

# Usage Analytics

Use the package CLI command `pi-usage-query` to answer questions about Pi usage analytics.

## What this package measures

- explicit `/skill:name` invocations from raw `input`
- tool executions from `tool_execution_start` / `tool_execution_end`
- repo scope from `ctx.cwd` via git repo-root resolution

It does **not** infer implicit model skill usage.

## Default scope rules

- If the user says **here**, **this repo**, or **current repo**, use `--scope=current`.
- Otherwise, use `--scope=all`.
- If the user gives a repo path, use `--repo <path>`.

## Preferred query flow

1. Start with a canned report:
   - `summary`
   - `skills`
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
pi-usage-query summary --scope=all
pi-usage-query skills --scope=current --days=7
pi-usage-query tools --repo /path/to/repo --limit=20
pi-usage-query extension-tools --scope=all
pi-usage-query failures --scope=current
pi-usage-query slow-tools --scope=all --days=30
pi-usage-query repos --scope=all
```

## SQL escape hatch

Use only read-only SQL. Stick to `SELECT` / `WITH` queries. SQL mode runs your query as written; canned-report flags are not applied for you.

```bash
pi-usage-query sql "SELECT skill_name, COUNT(*) AS n FROM skill_invocations GROUP BY skill_name ORDER BY n DESC LIMIT 10"
```

## Response guidance

- Lead with the answer.
- Mention scope and time filter used.
- Mention the caveat when skill counts are involved: only explicit `/skill:name` commands are counted.
