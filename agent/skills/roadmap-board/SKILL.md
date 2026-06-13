---
name: roadmap-board
description: "Read and update the project's roadmap board natively from the agent — get a card, list/filter cards, move cards between columns, edit cards and epics, assign epics, and view a card's history. Use whenever asked to read, refine, plan, execute, or review a roadmap card (ROAD-xxx) or epic (EPIC-xxx), or to create/move/update/delete board items. Drives the board through its CLI; no running server, port, or MCP config required."
compatibility: "Requires Node 22+ (the board CLI uses node:sqlite). Resolves the CLI by walking up from cwd for a roadmap-board checkout (or set ROADMAP_CLI), and resolves the board by walking up for .pi/roadmap/roadmap.sqlite (or set ROADMAP_PROJECT_ROOT)."
allowed-tools: Bash(node:*)
metadata:
  card: ROAD-006
  epic: EPIC-002
---

# Roadmap Board

Drive the per-project roadmap board (SQLite source of truth at `.pi/roadmap/roadmap.sqlite`,
generated `ROADMAP.md`) without curl, clipboard, or a running server. A single helper script
resolves which board you mean, shells out to the board's own validating CLI, and returns JSON.

## Invoke

```sh
node <skill-dir>/scripts/roadmap.mjs <command> [...args]
```

The script self-resolves all paths, so run it from anywhere. Relative to this skill the helper is
`./scripts/roadmap.mjs`.

**How it finds things** (both env vars override; useful for worktrees or out-of-tree boards):
- **Board** — `$ROADMAP_PROJECT_ROOT`, else the nearest ancestor of `cwd` containing
  `.pi/roadmap/roadmap.sqlite`. The CLI runs with that directory as its working dir.
- **CLI** — `$ROADMAP_CLI`, else the nearest ancestor of `cwd` containing
  `roadmap-board/src/server/cli.js`, else the copy bundled in this repo.

If the board isn't found, run `init` in the project root (or set `ROADMAP_PROJECT_ROOT`).

## Reads (token-light — prefer these over dumping the whole board)

| Command | Returns |
| --- | --- |
| `get <id>` | One card with full fields **plus** its event history. Use this to read a card before refining/planning/executing it. |
| `list [--status S] [--epic E\|none]` | Slim list (`id, title, status, epic_id`), optionally filtered by column and/or epic (`--epic none` = unassigned). |
| `ready [--epic E\|none]` | Slim list of cards that are unblocked: they have dependencies and all of them are completed (and the card itself isn't). The "what can I pick up next" query. |
| `blocked-deps [--epic E\|none]` | Slim list of cards waiting on an incomplete dependency (the inverse of `ready`). Derived at render time, independent of the explicit `blocked` status. |
| `epics` | Slim epic list with derived `done/total` progress. |
| `events <id>` | Just a card's event history (audit trail). |

## Writes (validated by the board; an event is logged and `ROADMAP.md` re-exported on every one)

| Command | Notes |
| --- | --- |
| `add <title> [summary]` | New Triage card. |
| `update <id> <json>` | Patch `title`, `summary`, `depends_on`, `enables`, `blocked_reason`. IDs in `depends_on`/`enables` must exist and can't be self-links. |
| `move <id> <status> [reason]` | Move between columns. `move <id> blocked <reason>` **requires** a reason. |
| `assign-epic <cardId> <epicId>` / `clear-epic <cardId>` | Attach / detach an epic. |
| `epic-add <title> [summary]` | New epic. |
| `epic-update <id> <json>` | Patch epic `title`, `summary`, `sort_index`. |
| `epic-delete <id>` | Delete an epic; its cards are detached, not deleted. |
| `delete <id>` | Delete a card (agent may delete from any column). |
| `reorder <id,id,...>` | Reorder all Triage cards. |

JSON args are a single quoted object, e.g. `update ROAD-006 '{"summary":"…","depends_on":["ROAD-001"]}'`.

**Valid statuses:** `triage`, `backlog`, `up_next`, `in_progress`, `blocked`, `review`, `completed`.

## Notes

- Every write auto-exports `ROADMAP.md` — no manual `export` step is needed (it exists as `export` if you want to force it).
- The browser UI stays read-only; all mutations flow through this validating path.
- Errors from the board (unknown id, invalid status, missing blocked reason, cyclic/self deps) are
  surfaced verbatim on stderr with a non-zero exit.

## Typical card flow

```sh
node <skill-dir>/scripts/roadmap.mjs get ROAD-006              # read before acting
node <skill-dir>/scripts/roadmap.mjs move ROAD-006 in_progress # start work
node <skill-dir>/scripts/roadmap.mjs update ROAD-006 '{"summary":"…"}'
node <skill-dir>/scripts/roadmap.mjs move ROAD-006 review      # hand off
```
