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
