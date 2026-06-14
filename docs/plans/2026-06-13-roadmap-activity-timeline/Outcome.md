# ROAD-025 — Live agent activity timeline · Outcome

> Status: **Executed** (in review). Card: ROAD-025, Epic: EPIC-006, depends on ROAD-024 (ownership claims).
> Companion to [ExecPlan.md](./ExecPlan.md).

## What shipped

A live activity feed that answers *what is a Pi session doing right now, and what just happened* —
current step, notable tool/status events, stalls, and final results — surfaced both board-wide and
per-card, complementing ROAD-024's ownership claims.

The storage model is the one chosen up front: an **ephemeral in-memory ring buffer** in the `serve`
process (RAM only, never SQLite), merged at read time with durable board milestones (moves / claims /
releases) from the `events` table so the feed survives a server respawn instead of going blank.

## How it works (end to end)

1. **Capture (extension).** As a session runs, the roadmap extension's hooks (`agent_start/end`,
   `tool_execution_start/end`, `model_select`, `session_start/shutdown`) shape each event into a
   short, safe label and fire a **non-awaited** POST to the board server — the agent hot path is never
   blocked, and every failure is swallowed. `session_shutdown` is the one awaited send (it must land
   before the session detaches).
2. **Attribute + store (server).** `POST /api/activity` looks up the card the posting session
   currently holds (`cardClaimedBy`, reusing the claim) and appends `{session, kind, title, status,
   card_id, ts, seq}` to the ring (capped, oldest-evicted).
3. **Read (merge).** `GET /api/timeline` merges the live ring with `model.timelineEvents()` durable
   milestones into one newest-first feed, enriching live items with card titles. `--limit`, `--card`
   (scopes both halves), and `--session` (live-only) narrow it.
4. **Surface (UI + CLI).** The read-only board shows a global **Activity** drawer and a per-card
   **Live activity** section; `cli.js timeline` / the skill expose the same read over HTTP, degrading
   to an annotated empty result when no server is up.

## Security

Tool arguments are scrubbed **at the source**, before anything leaves the session: an allowlist in
`curateToolTitle` emits only safe hints — Bash shows its `description`, never the command body; file
tools show a basename, never contents; Grep/Glob show the pattern; WebFetch shows the host. No command
bodies, file contents, or tool results are ever stored or transmitted.

## Files

**Backend (`roadmap-board/`)**
- `src/server/activity.js` *(new)* — pure ring buffer (`createActivityRing`) + `mergeTimeline`; no I/O, fully unit-tested.
- `src/server/model.js` — added `timelineEvents`, `cardClaimedBy`, `cardTitleMap` reads (pure SELECTs; no schema change/migration).
- `src/server/server.js` — `POST /api/activity` (validate, attribute, append) + `GET /api/timeline` (merge, scope).
- `src/server/cli.js` — `timeline` command: reads `.server.json` for the live port, HTTP GET, graceful empty degradation.
- `src/client/main.jsx` — `ActivityPanel` drawer (2s poll), shared `ActivityList`/`ActivityGlyph`, per-card live section in `CardModal`, header toggle; **stalled** = a `running` step older than 90s.
- `src/client/styles.css` — drawer, feed rows, status glyphs (spinner/check/alert/clock/dot), live/reconnecting chip, mobile full-bleed.

**Extension (`agent/extensions/roadmap/`)**
- `core.ts` — pure shaping/formatting: `shapeActivity`, `curateToolTitle` (the security allowlist), glyphs, `buildActivityLines`.
- `server.ts` — `postActivity` (fire-and-forget, never rejects) + `fetchTimeline`.
- `index.ts` — `report()` helper, the six hooks, awaited shutdown send, and a `/road activity` subcommand.

**Skill / docs**
- `.claude/skills/roadmap-board/scripts/roadmap.mjs` — `timeline` added to passthrough.
- `.claude/skills/roadmap-board/SKILL.md` — timeline row (the one server-dependent read).
- `roadmap-board/README.md` — feature bullet, usage examples, and a "Live activity timeline" section.

## Validation

- **Backend:** `node --test tests/*.test.js` → **63 pass** (ring buffer + merge unit tests; POST/GET route tests covering attribution, `kind` required → 400, merge, `?card`/`?session` scoping).
- **Extension:** `node --test agent/extensions/roadmap/*.test.ts` → **28 pass** (shaping, curation security, glyph/format).
- **Client:** `vite build` → clean (15 modules, no errors).
- **Integrated smoke test:** live server, posted activity, `GET /api/timeline` returned the merged feed newest-first (live steps above real ROAD-025 milestones), `started_at` present, missing-`kind` → 400, session-scoped read returned live-only items. Zero DB mutation (activity is RAM-only).

## Notes / trade-offs

- Activity is intentionally **not** persisted: it's high-volume, short-lived telemetry. The cost is
  that the CLI/skill can't read it from SQLite — hence the HTTP-only `timeline` path — and a respawn
  drops the live half (mitigated by the milestone merge).
- The per-card modal shows **live items only**; durable moves/claims already appear in the card's
  History section, so the merge's milestone half is shown board-wide but suppressed per-card to avoid
  duplication.

## Post-execution notes (updates)

Captured while verifying the running board after execution:

- **`serve` needs a built `dist/`.** The Express server serves the React UI from `roadmap-board/dist/`,
  and registers `express.static(dist)` **only if `dist` exists at server startup** (`server.js:74-75`,
  a one-time `existsSync` check). `npm run build` (`vite build`) must have run before `serve` starts.
  Because `express.static` then reads from disk per request, rebuilding `dist` while the server is up
  is picked up live — but **deleting** `dist` mid-run makes `/` return Express's `Cannot GET /` 404.
  (Hit exactly this: `dist` was removed after a build check while a `serve` on `:4177` was live;
  rebuilding `dist` restored `GET / → 200` with no restart needed.)
- **`dist/` is a build artifact and is gitignored.** `roadmap-board/dist/` is already covered by
  `.gitignore:40`, so the bundled UI is never committed (the server regenerates it from
  `npm run build`; it is not source). (An earlier "not ignored" reading was a false negative from
  running `git check-ignore` with the wrong working directory — verified ignored from the repo root.)
- **No code change resulted from these notes** — they are operational guidance for running the board,
  not a defect in the timeline feature.
