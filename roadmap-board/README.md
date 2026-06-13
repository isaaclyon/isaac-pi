# Roadmap Board MVP

A local, per-project roadmap board for Pi-driven work.

- SQLite source of truth: `.pi/roadmap/roadmap.sqlite` (ignored)
- Configurable prompt templates: `.pi/roadmap/prompts.json` (committed)
- Generated markdown: `ROADMAP.md` (committed; do not edit directly)
- First-class Epics with derived `done / total` progress
- Fixed columns: Triage, Backlog, Up next, In progress, Blocked, Review, Completed
- The browser is read-only: users refine cards by copying a prompt for an agent (Refine + Brainstorm/Plan/Execute/Review)
- All card changes — create, edit, move, reorder, delete — flow through agents via the CLI/API validation layer

## Usage

```sh
cd roadmap-board
npm install
cd ..
node roadmap-board/src/server/cli.js init
node roadmap-board/src/server/cli.js epic-add "Improve roadmap UX" "Group related cards under progress rails"
node roadmap-board/src/server/cli.js add "Try an idea" "Optional summary"
node roadmap-board/src/server/cli.js assign-epic ROAD-001 EPIC-001
node roadmap-board/src/server/cli.js move ROAD-001 in_progress
node roadmap-board/src/server/cli.js ready        # cards whose dependencies are all completed
node roadmap-board/src/server/cli.js blocked-deps # cards waiting on an incomplete dependency
node roadmap-board/src/server/cli.js serve --port 4177
```

For development, one command runs both the API and the Vite UI with hot reload:

```sh
cd roadmap-board
npm run dev
```

This starts:
- `api` — Express on `:4177` with `node --watch` (auto-restarts on server/model edits), pointed at the parent project root (`ROADMAP_PROJECT_ROOT=..`)
- `ui` — Vite on `:5173` with React Fast Refresh; `/api` is proxied to `:4177`

Open http://127.0.0.1:5173. Editing `src/client/**` hot-swaps in the browser; editing `src/server/**` restarts the API. If port 4177 is already taken by another roadmap server, stop it first (only one can bind that port). Run the API or UI alone with `npm run dev:api` / `npm run dev:ui`.

After `npm run build`, `node roadmap-board/src/server/cli.js serve --port 4177` serves both the API and built React UI from the project root.

## Fresh clones and worktrees

The SQLite database is intentionally local. A fresh clone starts with an empty editable board and treats any committed `ROADMAP.md` as a read-only snapshot. Card IDs are sequential within the local database. If multiple worktrees need independent roadmaps, run the CLI from each worktree root.

## Concurrency model

The board is a single SQLite database in WAL mode. It is safe to run CLI commands (short-lived processes) alongside a long-running `serve` process against the same database — they coordinate through SQLite itself, no extra lock files:

- **WAL** lets any number of readers run concurrently with a single writer, so reads never block.
- **One writer at a time.** A second writer does not fail — `PRAGMA busy_timeout = 5000` makes it wait up to 5s for the write lock. Because mutations are tiny and fast, the wait is effectively imperceptible.
- **Every mutation is one transaction.** Each create / update / move / delete / reorder wraps its row writes, its event-log row, and the `ROADMAP.md` re-export in a single `BEGIN IMMEDIATE … COMMIT`. A crash or a rejected validation rolls the whole thing back — you never get a half-applied change, an orphaned event, or a burned card ID. `IMMEDIATE` takes the write lock at the start of the transaction, so writers queue cleanly instead of deadlocking on a lock upgrade.
- **`ROADMAP.md` is last-writer-wins.** It is a generated artifact derived from the database, regenerated inside the same transaction as the change that triggered it. If two writers commit back-to-back, the file reflects whichever committed last — which is always a complete, consistent snapshot, never a partial one. The database, not the markdown, is the source of truth.

## Schema migrations

The schema is versioned with `PRAGMA user_version` and upgraded forward automatically on every `openRoadmap`. Migrations are an ordered, append-only list (`MIGRATIONS` in `src/server/model.js`); on open, every step past the database's current version runs in its own transaction and the version is stamped. Each step is idempotent, so a database created before versioning existed (`user_version` 0, full-but-unversioned) replays the chain safely and converges on the current schema with no data loss. To evolve the schema, **append** a new migration step — never edit or reorder existing ones.
