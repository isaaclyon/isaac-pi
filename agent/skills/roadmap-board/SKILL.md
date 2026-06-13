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

## Lifecycle — how a card moves through the board

This board is the agent's control surface for planning and implementing work. Each card travels
through a fixed set of columns, and the project defines four canonical **prompt actions** (stored
in `.pi/roadmap/prompts.json`, templated with `{{id}}` / `{{title}}` / `{{direction}}`) that map
onto that journey. Treat the stages as the contract for what to do at each step:

| Stage | Prompt intent | What you do | Board move |
| --- | --- | --- | --- |
| **Brainstorm** | Sharpen a rough idea, do **not** plan or execute | Rewrite the card `summary` in place to make the idea clear | none (stays in Triage/Backlog) |
| **Plan** | Inspect the repo, produce an implementation plan, do **not** execute | Write the plan into `summary`; wire `depends_on`/`enables`; `assign-epic` | `backlog` → `up_next` |
| **Execute** | Implement, validate, update the board, export | Do the work, then record outcome in `summary` | `up_next` → `in_progress` → `review` |
| **Review** | Assess the implementation against the card before completion | Verify it matches the card; note gaps in `summary` | `review` → `completed` (or back) |

A fifth template, **refine**, applies one specific `{{direction}}` to a card in place (used by the
board UI's inline edits) — same shape as Brainstorm but targeted.

**Where the plan and notes live:** the card has no separate plan/review-notes field — the MVP schema
is deliberately minimal. The `summary` *is* the working document; append the plan, then the outcome,
as the card advances. The audit trail of moves/edits lives in `events <id>`.

**Status flow is convention, not enforced.** `move` validates the column name but there is **no
transition graph** — any column can move to any other. You own sane progression. The intended path:

```
triage → backlog → up_next → in_progress → review → completed
                                    ↘ blocked (side state; requires a reason) ↗
```

**Picking work:** `ready` is the "what can I start now" query (deps all completed). Start there,
not from a full board dump.

## Reads (token-light — prefer these over dumping the whole board)

| Command | Returns |
| --- | --- |
| `get <id>` | One card with full fields (incl. derived `ready` / `dependency_blocked` booleans) **plus** its event history. Use this to read a card before refining/planning/executing it. |
| `list [--status S] [--epic E\|none]` | Slim list (`id, title, status, epic_id`), optionally filtered by column and/or epic (`--epic none` = unassigned). |
| `ready [--epic E\|none]` | Slim list of cards that are unblocked: they have dependencies and all of them are completed (and the card itself isn't). The "what can I pick up next" query. |
| `blocked-deps [--epic E\|none]` | Slim list of cards waiting on an incomplete dependency (the inverse of `ready`). Derived at render time, independent of the explicit `blocked` status. |
| `epics [--archived\|--all]` | Slim epic list with derived `done/total` progress, plus `is_complete` (all cards done) and `archived`. Returns **active** epics by default; `--archived` for archived only, `--all` for both. |
| `events <id>` | Just a card's event history (audit trail). |

## Writes (validated by the board; an event is logged and `ROADMAP.md` re-exported on every one)

| Command | Notes |
| --- | --- |
| `add <title> [summary]` | New Triage card (logged as the **user** actor). |
| `update <id> <json>` | Agent patch of `title`, `summary`, `depends_on`, `enables`, `blocked_reason`, `documents`. IDs in `depends_on`/`enables` must exist and can't be self-links. `documents` is an ordered array of `{title, href, kind?, note?}` references. This is your main editing verb. |
| `user-update <id> <json>` | User patch of `title`/`summary` only, and **only while the card is in Triage** (mirrors the human's edit lane). Prefer `update` for agent work. |
| `attach-doc <id> <title> <href> [kind] [note]` / `detach-doc <id> <href>` | Attach or remove supporting document/artifact references by href. |
| `move <id> <status> [reason]` | Move between columns. `move <id> blocked <reason>` **requires** a reason. |
| `claim <id> [owner] [note]` / `release <id> [owner]` | Advisory ownership claim so concurrent agents see who's holding a card. `owner` defaults to `$ROADMAP_SESSION_ID`; claiming a card held by someone else needs `--force` (logs `stolen_from`), as does releasing a mismatched owner. Claims are transient — they live in the DB/UI/events but are **not** exported to `ROADMAP.md`. |
| `assign-epic <cardId> <epicId>` / `clear-epic <cardId>` | Attach / detach an epic. |
| `epic-add <title> [summary]` | New epic. |
| `epic-update <id> <json>` | Patch epic `title`, `summary`, `sort_index`. |
| `epic-delete <id>` | Delete an epic; its cards are detached, not deleted. |
| `epic-archive <id>` / `epic-unarchive <id>` | Archive (reversible) / restore an epic. Archiving hides it from active views (rail, `## Epics`, default `epics` read) while keeping its cards and history intact; cards are untouched. The non-destructive alternative to `epic-delete` for finished or abandoned epics. |
| `reorder-epics <id,id,...>` | Reorder all epics by setting `sort_index` densely; must list every epic exactly once. |
| `delete <id>` | Delete a card (agent may delete from any column). |
| `reorder <id,id,...>` | Reorder all Triage cards. |

JSON args are a single quoted object, e.g. `update ROAD-006 '{"summary":"…","depends_on":["ROAD-001"]}'`.

**Valid statuses:** `triage`, `backlog`, `up_next`, `in_progress`, `blocked`, `review`, `completed`.

## The model the board enforces

- **Actor lane.** Every write is attributed to an actor. The agent owns all columns *except* intake:
  `update`/`move`/`delete`/epic verbs run as **agent**; `add`/`user-update` run as **user** and are
  restricted to Triage. There is no security boundary here — it's a workflow convention the CLI
  validates. As the agent, drive cards with `update`/`move`; leave Triage capture to the human.
- **Dependencies are one directed graph.** `depends_on` and `enables` are inverse edges: setting
  `enables: ["ROAD-B"]` on ROAD-A is the *same* edge as `depends_on: ["ROAD-A"]` on ROAD-B. Either
  side is fine — pick whichever reads better at the card you're editing. The board rejects links to
  unknown ids, self-links, and any link that would close a cycle. `delete` auto-strips a card's id
  from every other card's links, so deletes never leave dangling references.
- **`ready` / `dependency_blocked` are derived, not stored.** A card is `ready` when it has deps and
  all are completed; `dependency_blocked` is the inverse. Both are orthogonal to the **`blocked`
  status column** (a manual side state that needs a `blocked_reason`). Don't set `blocked` for a
  dependency wait — that's already surfaced by `blocked-deps`.
- **Claims are advisory, not locks.** `claim`/`release` annotate a card with the session actively
  holding it so concurrent agents can coordinate; they never block a write. The owner is an opaque
  string (session id by default), the guard is overridable with `--force`, and the state is transient
  — it stays in the DB, the live board, and the event log, but is deliberately kept out of the
  committed `ROADMAP.md` so stale session ids never churn the shared snapshot.

## Notes

- Every write auto-exports `ROADMAP.md` — no manual `export` step is needed (it exists as `export` if you want to force it).
- **`ROADMAP.md` is a generated, committed artifact; `.pi/roadmap/roadmap.sqlite` is gitignored local state.** When you finish board work as part of a change, commit the regenerated `ROADMAP.md` alongside the code so the shared snapshot tracks reality. A fresh clone treats `ROADMAP.md` as read-only — it does not rehydrate the DB.
- The browser UI stays read-only; all mutations flow through this validating path. To let a human watch the board you're driving, run the board's own CLI: `node roadmap-board/src/server/cli.js serve [--port 4177]`. (`paths` prints the resolved db/markdown/prompts locations.)
- Errors from the board (unknown id, invalid status, missing blocked reason, cyclic/self deps) are
  surfaced verbatim on stderr with a non-zero exit.

## Typical card flow (the full loop)

```sh
R="node <skill-dir>/scripts/roadmap.mjs"

$R ready                                          # what can I pick up now?
$R get ROAD-006                                   # read the card + history before acting

# Plan: record the plan in the summary, wire deps, group under an epic
$R update ROAD-006 '{"summary":"Plan: …","depends_on":["ROAD-001"]}'
$R assign-epic ROAD-006 EPIC-002
$R move ROAD-006 up_next

# Execute: take it, do the work, capture the outcome
$R move ROAD-006 in_progress
$R update ROAD-006 '{"summary":"Done: … (see <file>:<line>)"}'
$R move ROAD-006 review                           # hand off for review

# Review → complete (auto-exports ROADMAP.md), then commit the snapshot with your code
$R move ROAD-006 completed
git add ROADMAP.md && git commit            # ROADMAP.md is the committed, shared snapshot
```
