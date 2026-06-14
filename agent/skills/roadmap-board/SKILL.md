---
name: roadmap-board
description: "Read and update the project's roadmap board — get a card, list/filter cards, move cards between columns, edit cards and epics, assign epics, and view a card's history. Use whenever asked to read, refine, plan, execute, or review a roadmap card (ROAD-xxx) or epic (EPIC-xxx), or to create/move/update/delete board items. When the roadmap extension is loaded, prefer its native roadmap_* tools; otherwise this skill drives the same validating CLI — no running server, port, or MCP config required."
compatibility: "Requires Node 22+ (the board CLI uses node:sqlite). Resolves the CLI by walking up from cwd for a roadmap-board checkout (or set ROADMAP_CLI), and resolves the board by walking up for .pi/roadmap/roadmap.sqlite (or set ROADMAP_PROJECT_ROOT)."
allowed-tools: Bash(node:*)
metadata:
  card: ROAD-006
  epic: EPIC-002
---

# Roadmap Board

The per-project roadmap board is a SQLite source of truth (`.pi/roadmap/roadmap.sqlite`) with a
generated, committed `ROADMAP.md`. It has two faces over one validating core: native LLM tools when
the roadmap extension is loaded, and a CLI fallback for everything else. This skill is the **policy
and lifecycle narrative** — what a card means, how it moves, and what the board enforces. The
mechanics live in the tools/CLI below.

> **Which interface are you?** The native `roadmap_*` tools only exist when the **pi agent roadmap
> extension** is loaded. If you don't have those tools (e.g. you're Claude Code or a subagent), skip
> the "Native tools" section below and drive the [CLI fallback](#cli--fallback-for-tool-less-contexts)
> — it's the same validating core, just invoked as `node <skill-dir>/scripts/roadmap.mjs`.

## Interfaces

### Native tools — preferred when available (pi agent extension only)

When the roadmap extension is loaded, six `roadmap_*` tools are the structured interface — no shell
quoting, no path resolution, validated params. Reach for these first:

| Tool | What it does |
| --- | --- |
| `roadmap_get` | Read one card with full fields (summary, deps, documents, derived `ready`/`dependency_blocked`) **plus** its event history. Read a card with this before refining/planning/executing/reviewing it. |
| `roadmap_list` | Query the board by `view`: `list` (all cards, filter by `status`/`epic`), `ready` (unblocked — start here), `blocked` (waiting on a dependency), `epics` (progress), `timeline` (live agent activity). |
| `roadmap_update` | The main editing verb — patch `title`, `summary`, `depends_on`/`enables`, `blocked_reason`, or `documents` (replaces the whole ordered list). |
| `roadmap_move` | Move a card between columns; moving to `blocked` requires a `reason`. |
| `roadmap_claim` | Advisory ownership claim (or `release:true` to drop yours) so concurrent agents coordinate; `force` steals/overrides. Owner is this session. |
| `roadmap_epic` | Manage epics via `op`: `add`, `update`, `assign`, `clear`, `delete`, `archive`, `unarchive`, `reorder`. |

### CLI — fallback for tool-less contexts

When the tools aren't loaded (a subagent, or a repo without the extension), drive the **same**
validating core through the CLI:

```sh
node <skill-dir>/scripts/roadmap.mjs <command> [...args]
```

The script self-resolves all paths, so run it from anywhere; relative to this skill it's
`./scripts/roadmap.mjs`. Run `… help` for the full command list. JSON args are a single quoted
object, e.g. `update ROAD-006 '{"summary":"…","depends_on":["ROAD-001"]}'`.

**How it finds things** (both env vars override; useful for out-of-tree boards):
- **Board** — `$ROADMAP_PROJECT_ROOT`, else the **main checkout** (resolved via
  `git rev-parse --git-common-dir`), else the nearest ancestor of `cwd` containing
  `.pi/roadmap/roadmap.sqlite`. The CLI runs with that directory as its working dir.
  Because a linked worktree's `.git` points at the primary checkout, the board always
  resolves to the main repo — running from a worktree (or any subdirectory) reads and
  writes the **same** board, never a stray per-worktree copy.
- **CLI** — `$ROADMAP_CLI`, else the nearest ancestor of `cwd` containing
  `roadmap-board/src/server/cli.js`, else the copy bundled in this repo.

If the board isn't found, run `init` in the project root (or set `ROADMAP_PROJECT_ROOT`).

A few operations live **only** on the CLI (no native tool, by design):
- `add <title> [summary]` / `user-update <id> <json>` — Triage capture and Triage-only title/summary
  edits: the **human's** intake lane. Leave these to the user; don't create cards yourself.
- `attach-doc <id> <title> <href> [kind] [note]` / `detach-doc <id> <href>` — incremental single-doc
  tweaks by href (the `roadmap_update` `documents` field replaces the whole list at once).
- `delete <id>` — delete a card from any column (auto-strips its id from every other card's links).
- `reorder <id,id,...>` — reorder all Triage cards.
- `export` — force a `ROADMAP.md` re-export (every write auto-exports, so this is rarely needed).
- `init` / `serve [--port 4177]` / `paths` — create a board, run the read-only viewer, print
  resolved db/markdown/prompts paths.

## Lifecycle — how a card moves through the board

This board is the agent's control surface for planning and implementing work. Each card travels
through a fixed set of columns, and the project defines four canonical **prompt actions** (stored
in `.pi/roadmap/prompts.json`, templated with `{{id}}` / `{{title}}` / `{{direction}}`) that map
onto that journey. Treat the stages as the contract for what to do at each step:

| Stage | Prompt intent | What you do | Board move |
| --- | --- | --- | --- |
| **Brainstorm** | Sharpen a rough idea, do **not** plan or execute | Rewrite the card `summary` in place to make the idea clear and concise | none (stays in Triage/Backlog) |
| **Plan** | Inspect the repo, produce an implementation plan, do **not** execute | **Attach the plan as a document**; wire `depends_on`/`enables`; `assign-epic` | `backlog` → `up_next` |
| **Execute** | Implement, validate, update the board, export | Do the work, then **attach the outcome/notes as a document** | `up_next` → `in_progress` → `review` |
| **Review** | Assess the implementation against the card before completion | Verify it matches the card; **attach review notes as a document** | `review` → `completed` (or back) |

A fifth template, **refine**, applies one specific `{{direction}}` to a card in place (used by the
board UI's inline edits) — same shape as Brainstorm but targeted.

**Where the plan and notes live:** keep `summary` a **concise description** of the card — what the
work is and why — not a running log. Plans, execution outcomes, and review notes belong in
**documents** — set via the `documents` array on `roadmap_update` (or `attach-doc` on the CLI for an
incremental add) — so the description stays readable and each artifact is addressable on its own:

- **Prose plans / outcomes / review notes** — write them to a file in the repo (e.g.
  `docs/roadmap/<id>-plan.md`), commit it, then attach it (`kind` like `plan`, `outcome`, `review`).
- **External artifacts** — attach a PR, design doc, dashboard, or issue by URL directly
  (`kind` like `pr`, `design`, `issue`).

Each document is `{title, href, kind?, note?}`; `note` is a one-line gloss, not the full body. The
audit trail of moves/edits lives in `events <id>`.

**Status flow is convention, not enforced.** `move` validates the column name but there is **no
transition graph** — any column can move to any other. You own sane progression. The intended path:

```
triage → backlog → up_next → in_progress → review → completed
                                    ↘ blocked (side state; requires a reason) ↗
```

The full set of valid columns: `triage`, `backlog`, `up_next`, `in_progress`, `blocked`, `review`,
`completed`.

**Picking work:** the `ready` view (`roadmap_list view:ready`) is the "what can I start now" query
(deps all completed). Start there, not from a full board dump.

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
  dependency wait — that's already surfaced by the `blocked` view (`roadmap_list view:blocked`).
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

The lifecycle in native-tool terms (in a tool-less context, substitute the equivalent CLI command —
see [CLI fallback](#cli--fallback-for-tool-less-contexts)):

1. **Pick & read.** `roadmap_list view:ready` → what can I start now? Then `roadmap_get id:ROAD-006`
   → read the card and its history before acting.
2. **Plan.** Write the prose plan to a repo file (`docs/roadmap/ROAD-006-plan.md`) and commit it,
   then point the card at it: `roadmap_update id:ROAD-006 summary:"Short description." depends_on:["ROAD-001"]
   documents:[{title:"Implementation plan", href:"docs/roadmap/ROAD-006-plan.md", kind:"plan"}]`. Group it
   with `roadmap_epic op:assign cardId:ROAD-006 epicId:EPIC-002`, then `roadmap_move id:ROAD-006 status:up_next`.
3. **Execute.** `roadmap_move id:ROAD-006 status:in_progress`, do the work, then record the outcome and
   any external artifacts in `documents` (a build-notes file by path, a PR by URL). `roadmap_move
   id:ROAD-006 status:review`.
4. **Review → complete.** `roadmap_move id:ROAD-006 status:completed` (auto-exports `ROADMAP.md`), then
   `git add ROADMAP.md && git commit` alongside your code — `ROADMAP.md` is the committed, shared snapshot.

**Appending documents:** `roadmap_update documents:[…]` **replaces** the whole list, so when adding a
doc to a card that already has some, include the prior entries too — or use the CLI's `attach-doc`
for a one-off incremental add.
