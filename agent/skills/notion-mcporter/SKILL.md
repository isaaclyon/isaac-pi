---
name: notion-mcporter
description: "Use the Notion MCP through the `mcporter` CLI. Use when you need to search, fetch, or mutate Notion content via mcporter without dumping the full Notion tool catalog into context."
---

# Notion via mcporter

Use `mcporter` as the interface to the hosted Notion MCP.

## Goal

Work with Notion while keeping context usage small.

## Rules

- Prefer direct `mcporter call notion.<tool>(...)` invocations over `mcporter list notion`.
- Do **not** run `mcporter list notion` unless you explicitly need to rediscover tool names or signatures.
- If you must inspect the tool catalog, redirect it to a file and read/filter that file instead of pasting the whole output into context.
- Keep result sizes small: use low `page_size`, short highlight lengths, and targeted fetches.

## Auth

If Notion is not authenticated yet, run:

```bash
npx -y mcporter auth notion
```

If the server is not named in config, use the hosted endpoint directly:

```bash
npx -y mcporter auth https://mcp.notion.com/mcp
```

## Safe discovery workflow

Check that the server exists without dumping every tool:

```bash
npx -y mcporter list
```

If you need the full Notion signatures, write them to a file first:

```bash
npx -y mcporter list notion > /tmp/notion-tools.txt
```

Then inspect only the parts you need:

```bash
rg -n "notion-search|notion-fetch|notion-create" /tmp/notion-tools.txt
sed -n '1,160p' /tmp/notion-tools.txt
```

## Common calls

Search Notion workspace content:

```bash
npx -y mcporter call 'notion.notion-search(query: "roadmap", query_type: "internal", page_size: 5, max_highlight_length: 120)'
```

Search for a user:

```bash
npx -y mcporter call 'notion.notion-search(query: "alice@example.com", query_type: "user")'
```

Fetch a page, database, or data source by URL or ID:

```bash
npx -y mcporter call 'notion.notion-fetch(id: "https://www.notion.so/..." )'
```

Fetch with discussions included:

```bash
npx -y mcporter call 'notion.notion-fetch(id: "<page-id>", include_discussions: true)'
```

## Working pattern

1. Search narrowly.
2. Extract the target page/database/data-source ID or URL from results.
3. Fetch that single target.
4. Only then call a write tool if needed.

This keeps both MCP responses and agent context small.

## Notes from current Notion MCP

Current `mcporter list notion` output shows:

- server name: `notion`
- transport: hosted HTTP MCP at `https://mcp.notion.com/mcp`
- at least these useful tools:
  - `notion-search`
  - `notion-fetch`
  - create/update tools for pages, databases, and views

`mcporter` exposes those tools under the server-qualified call form, for example:

```bash
npx -y mcporter call 'notion.notion-search(query: "weekly planning", query_type: "internal")'
```

## When to fall back to listing

Use `mcporter list notion` only when:

- you do not know the exact tool name
- you need parameter names for a specific write operation
- the server behavior changed and examples no longer work

Prefer saving the listing to a file and grepping it instead of printing it inline.
