# Roadmap Board MVP

A local, per-project roadmap board for Pi-driven work.

- SQLite source of truth: `.pi/roadmap/roadmap.sqlite` (ignored)
- Configurable prompt templates: `.pi/roadmap/prompts.json` (committed)
- Generated markdown: `ROADMAP.md` (committed; do not edit directly)
- First-class Epics with derived `done / total` progress
- Fixed columns: Triage, Backlog, Up next, In progress, Blocked, Review, Completed
- The browser is read-only: users refine cards by copying a prompt for an agent (Refine + Brainstorm/Plan/Execute/Review)
- All card changes — create, edit, move, reorder, delete — flow through agents via the CLI/API validation layer
- Cards can carry ordered supporting document references (`title`, `href`, optional `kind`/`note`); the board stores references, not uploaded file blobs
- Cards can carry a transient **ownership claim** (`claimed_by`, `claimed_at`, optional note) so concurrent agents see which session is actively holding a card; claims live in the DB and UI but are intentionally excluded from the committed `ROADMAP.md`
- An optional **activity timeline** can surface live session telemetry when an external producer posts events to the server; otherwise it falls back to durable board milestones such as moves and claim/release events

## Usage

```sh
cd roadmap-board
npm install
cd ..
node roadmap-board/src/server/cli.js init
node roadmap-board/src/server/cli.js epic-add "Improve roadmap UX" "Group related cards under progress rails"
node roadmap-board/src/server/cli.js add "Try an idea" "Optional summary"
node roadmap-board/src/server/cli.js attach-doc ROAD-001 "Review notes" docs/review.md review
node roadmap-board/src/server/cli.js assign-epic ROAD-001 EPIC-001
node roadmap-board/src/server/cli.js move ROAD-001 in_progress
node roadmap-board/src/server/cli.js claim ROAD-001 alice "wiring up the API"  # active ownership claim
node roadmap-board/src/server/cli.js release ROAD-001 alice                     # drop the claim
node roadmap-board/src/server/cli.js ready        # cards whose dependencies are all completed
node roadmap-board/src/server/cli.js blocked-deps # cards waiting on an incomplete dependency
node roadmap-board/src/server/cli.js timeline --limit 20          # timeline feed (needs a running server)
node roadmap-board/src/server/cli.js timeline --card ROAD-001     # timeline scoped to one card
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

The SQLite database is intentionally local. A fresh clone starts with an empty editable board and treats any committed `ROADMAP.md` as a read-only snapshot. Card IDs are sequential within the local database.

**Worktrees share the main checkout's board.** The CLI resolves its project root via `git rev-parse --git-common-dir` (then its parent), and a linked worktree's `.git` points at the primary checkout — so commands run from any worktree (or any subdirectory) read and write the one board under the main repo's `.pi/roadmap/`, not a stray per-worktree copy. Set `$ROADMAP_PROJECT_ROOT` to override (e.g. a genuinely separate board, or an out-of-tree project).

## Concurrency model

The board is a single SQLite database in WAL mode. It is safe to run CLI commands (short-lived processes) alongside a long-running `serve` process against the same database — they coordinate through SQLite itself, no extra lock files:

- **WAL** lets any number of readers run concurrently with a single writer, so reads never block.
- **One writer at a time.** A second writer does not fail — `PRAGMA busy_timeout = 5000` makes it wait up to 5s for the write lock. Because mutations are tiny and fast, the wait is effectively imperceptible.
- **Every mutation is one transaction.** Each create / update / move / delete / reorder wraps its row writes, its event-log row, and the `ROADMAP.md` re-export in a single `BEGIN IMMEDIATE … COMMIT`. A crash or a rejected validation rolls the whole thing back — you never get a half-applied change, an orphaned event, or a burned card ID. `IMMEDIATE` takes the write lock at the start of the transaction, so writers queue cleanly instead of deadlocking on a lock upgrade.
- **`ROADMAP.md` is last-writer-wins.** It is a generated artifact derived from the database, regenerated inside the same transaction as the change that triggered it. If two writers commit back-to-back, the file reflects whichever committed last — which is always a complete, consistent snapshot, never a partial one. The database, not the markdown, is the source of truth.

### Ownership claims

`claim <id> [owner] [note]` / `release <id> [owner]` let concurrent agents signal which session is actively working a card. A claim is **advisory coordination, not a lock** — it never blocks a write, it just records `claimed_by` / `claimed_at` so other sessions (and the live board) can see the card is taken.

- **Owner is an opaque string.** The CLI defaults to `$ROADMAP_SESSION_ID`, or you can pass any label (`alice`). The board does not interpret it.
- **Claiming a held card is guarded.** A different owner claiming an already-claimed card gets a `409` unless they pass `--force` (which records `stolen_from` in the event log). Re-claiming as the same owner just refreshes the note. `release` has the symmetric guard: a mismatched owner needs `--force`.
- **Claims are transient and excluded from `ROADMAP.md`.** Like the gitignored `.server.json`, claim state is per-session live coordination, not part of the committed snapshot — exporting it would churn the shared file with stale session ids. It lives in SQLite, the `/api/roadmap` feed, the read-only UI chip, and the event log only.
- **Claims persist until explicitly released or overwritten.** If you use session-scoped owner ids, make sure your workflow releases them when work ends.

### Activity timeline

The activity timeline is an optional live complement to ownership claims. If an external producer posts session/tool events to the server over HTTP, the server attributes them to whatever card that session currently holds and appends them to an in-memory ring.

- **Ephemeral by design — RAM, never SQLite.** Live activity is high-volume, short-lived telemetry: useful while a session runs, worthless once it's gone. It lives in a bounded ring buffer in the `serve` process (capped, oldest-evicted) so it never migrates the schema, churns the gitignored DB, or needs a retention policy. Two consequences follow directly:
  1. **The `timeline` read goes over HTTP, not through SQLite.** A short-lived CLI process opens its own DB connection and cannot see the server's RAM, so `timeline` reads `.pi/roadmap/.server.json` for the live port and asks the running server — degrading to an annotated empty result when none is up.
  2. **A restart re-merges durable milestones.** A server respawn (code edit, last-session detach) empties the ring, so `GET /api/timeline` merges the live ring with recent board milestones (moves/claims/releases) from the event log. The feed degrades to history rather than going blank.
- **Two surfaces, one feed.** The read-only UI shows a global **Activity** drawer (board-wide, newest-first, 2s poll) and a per-card **Live activity** section in the card modal (`?card=<id>`). A step still marked `running` past a threshold is rendered as **stalled**, surfacing a wedged session at a glance.
- **Sanitize events before posting them.** The server trusts producers to avoid sending sensitive payloads; prefer short labels and metadata rather than raw command bodies or file contents.
- **Scoped reads.** `GET /api/timeline` (and `cli.js timeline`) accept `--limit`, `--card`, and `--session`. `--card` scopes both halves of the merge; `--session` returns that session's live activity only (sessions don't own milestones).

## Schema migrations

The schema is versioned with `PRAGMA user_version` and upgraded forward automatically on every `openRoadmap`. Migrations are an ordered, append-only list (`MIGRATIONS` in `src/server/model.js`); on open, every step past the database's current version runs in its own transaction and the version is stamped. Each step is idempotent, so a database created before versioning existed (`user_version` 0, full-but-unversioned) replays the chain safely and converges on the current schema with no data loss. To evolve the schema, **append** a new migration step — never edit or reorder existing ones.
