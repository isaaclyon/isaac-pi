# Roadmap Board MVP

A local, per-project roadmap board for Pi-driven work.

- SQLite source of truth: `.pi/roadmap/roadmap.sqlite` (ignored)
- Configurable prompt templates: `.pi/roadmap/prompts.json` (committed)
- Generated markdown: `ROADMAP.md` (committed; do not edit directly)
- Fixed columns: Triage, Backlog, Up next, In progress, Blocked, Review, Completed
- Users can add/edit/reorder Triage cards only
- Agents update cards through the CLI/API validation layer

## Usage

```sh
cd roadmap-board
npm install
cd ..
node roadmap-board/src/server/cli.js init
node roadmap-board/src/server/cli.js add "Try an idea" "Optional summary"
node roadmap-board/src/server/cli.js move ROAD-001 in_progress
node roadmap-board/src/server/cli.js serve --port 4177
```

For development, run the API and Vite separately. The API must point at the project root whose `.pi/roadmap/` and `ROADMAP.md` you want to use:

```sh
cd roadmap-board
ROADMAP_PROJECT_ROOT=.. npm run serve
npm run dev
```

After `npm run build`, `node roadmap-board/src/server/cli.js serve --port 4177` serves both the API and built React UI from the project root.

## Fresh clones and worktrees

The SQLite database is intentionally local. A fresh clone starts with an empty editable board and treats any committed `ROADMAP.md` as a read-only snapshot. Card IDs are sequential within the local database. If multiple worktrees need independent roadmaps, run the CLI from each worktree root.
