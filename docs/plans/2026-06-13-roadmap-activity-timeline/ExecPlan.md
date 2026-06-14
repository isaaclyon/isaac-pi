# ROAD-025 — Live agent activity timeline

> Status: **Plan** (not yet executed). Card: ROAD-025, Epic: EPIC-006, depends on ROAD-024 (ownership claims).

## Purpose

Give the roadmap board a chronological feed of **what Pi sessions are doing right now and what just
happened** — current step, notable tool/status events, stalls, and final results — so a human (or a
coordinating agent) watching the board can see live work in motion, not just the static column state.

This is the observable-over-time complement to ROAD-024's ownership claims: a claim answers *who holds
this card*; the timeline answers *what has that holder actually been doing*. The two compose — activity
is attributed to a card by reusing the claim (`claimed_by === sessionId`) at write time, so a claimed
card's modal can show its own activity for free.

## Definition of Done

- A running Pi session emits activity events (agent start/end, notable tool start/end, model select,
  session start/shutdown) to the shared board server as it works, **without measurably slowing the
  agent's hot path** (fire-and-forget, non-awaited POST; failures are swallowed).
- The board UI shows:
  - a **global Activity panel** (header toggle, same 2s poll cadence as the board) listing the most
    recent activity across all live sessions, newest first, with relative ages and a running/stalled/
    done affordance; and
  - **per-card activity** inside the existing `CardModal`, scoped to that card.
- The feed **survives a server respawn**: after the server restarts (e.g. a code edit retriggers the
  codeVersion gate, or the last session detached and a new one spawned a fresh server), the panel still
  shows durable milestone events (claims, moves) merged with whatever live activity exists now — it
  degrades, it does not go blank-and-wrong.
- A `timeline` read is available from the **CLI** and **skill**, and **degrades to an empty result with
  a clear note when no server is running** (because the live ring buffer lives only in the server's RAM
  and a short-lived CLI process cannot see it).
- No new SQLite migration. `SCHEMA_VERSION` is unchanged. `ROADMAP.md` is unchanged (activity, like
  claims, is transient session state and is deliberately excluded from the committed snapshot).
- Tests cover the ring buffer, the new routes, and the pure activity-shaping helpers. README + SKILL
  docs describe the `timeline` command and its server-dependence.

## Architecture & key components

The board is a single validating core (`cli.js` → `model.js`) wrapped by an Express server, a React
client, a Pi extension, and a skill. The timeline threads through five of those layers. The **store is
the one place that does *not* change structurally** — the ephemeral decision keeps live activity out of
SQLite entirely.

### Storage model — ephemeral ring buffer in the server process

Live activity lives in a **bounded in-memory ring buffer inside `server.js`** (one server per project
root, already refcounted across sessions). It is **not** persisted to SQLite and is **lost on respawn
or last-session-detach**. This is the deliberate, user-chosen design.

Three consequences drive the rest of the plan:

1. **Timeline reads are HTTP-only.** The CLI and skill each open their *own* short-lived SQLite
   connection in a separate process — they cannot see the server's RAM. So a `timeline` read must locate
   `.pi/roadmap/.server.json`, hit the live server over HTTP, and return empty (with a note) when no
   server is up. Every other CLI read goes through SQLite; this is the one that does not.
2. **The feed must survive respawn.** `GET /api/timeline` returns the **union** of (a) ephemeral activity
   from the ring and (b) durable *milestone* events read from the SQLite `events` table (claims, moves).
   After a respawn the ring is empty but the milestones remain, so the panel still shows recent history
   instead of going blank.
3. **The server attributes activity to a card.** When activity is POSTed, the server looks up which card
   (if any) has `claimed_by === sessionId` and tags the event with that `card_id`. The extension stays
   dumb (it just reports "I did X"); the server does the card association, which wires per-card activity
   in the modal automatically.

### Component map

| Layer | File | Change |
| --- | --- | --- |
| Ring buffer | `roadmap-board/src/server/activity.js` (**new**) | Pure, testable bounded ring: `append(event)`, `list({limit, session, card})`, cap (~200). No I/O. |
| Server routes | `roadmap-board/src/server/server.js` | `POST /api/activity` (append + card attribution via `store` claim lookup); `GET /api/timeline?limit&session&card` (merge ring + `store.timelineEvents`). Editing this file **triggers a server respawn** via the codeVersion gate — expected. |
| Store read | `roadmap-board/src/server/model.js` | One new read `timelineEvents(limit)` — a `SELECT` of recent milestone events (`card_claimed`/`card_released`/`card_moved`) across all cards. **No migration, no schema change**; `card_id` is already nullable and `actor_type` already allows `agent`. |
| Extension capture | `agent/extensions/roadmap/index.ts` | New `pi.on(...)` hooks (curated set below) → shape via `core.ts` → fire-and-forget POST via a new helper in `server.ts`. New `/road activity` command reads `GET /api/timeline`. |
| Extension shaping | `agent/extensions/roadmap/core.ts` | Pure `shapeActivity(eventName, payload)` → `{kind, title, status}` with truncation/curation rules. Mirrors the existing pure-core split; unit-tested in `core.test.ts`. |
| Extension effect | `agent/extensions/roadmap/server.ts` | New `postActivity(port, body)` helper mirroring `fetchSnapshot`'s `http.request` pattern, but POST and **non-awaited / never throwing**. |
| CLI | `roadmap-board/src/server/cli.js` | New `timeline [--limit N] [--session S] [--card C]` command: read `.server.json` port, HTTP GET `/api/timeline`, print JSON; empty + note when no server. **Does not** open the store for this command. |
| Skill | `agent/skills/roadmap-board/scripts/roadmap.mjs` + `SKILL.md` | Pass `timeline` through; document server-dependence. |
| Client | `roadmap-board/src/client/main.jsx` | Global Activity panel (header toggle, 2s poll of `/api/timeline`) + per-card activity section in `CardModal` (`/api/timeline?card=ID`). Reuse `formatClaimAge` for relative ages and `describeEvent`-style rendering. |
| Styles | `roadmap-board/src/client/styles.css` | Activity panel + running/stalled/done row styles. **Client edits need no respawn** (the bundle is read per-request). |

### Captured event set (curated, not everything)

Hook into these Pi lifecycle events and shape each into a small record `{session, kind, title, status,
ts}`:

- `agent_start` / `agent_end` → "started working" / "finished" (status: running → done).
- `tool_execution_start` / `tool_execution_end` (paired by `toolCallId`) → "running <tool>: <curated
  title>" → "<tool> ok|error". Titles are **truncated and curated**.
- `model_select` → "switched model to <name>".
- `session_start` / `session_shutdown` → session lifecycle bookends.

**Deliberately excluded:** `message_update` (token-by-token streaming — far too chatty for a feed) and
any raw payloads. **Security/size rules:** never send full bash command strings, file contents, or tool
results; store only a short curated title and an ok/error flag. The POST is fire-and-forget so a slow or
absent server never stalls the agent.

### Merge + attribution flow (the heart of it)

```
extension hook ──shape(core.ts)──▶ POST /api/activity {session, kind, title, status}
                                         │
                                server.js: look up card where claimed_by === session
                                         │ tag card_id
                                         ▼
                                 ring.append({...event, card_id})
                                         │
GET /api/timeline?limit&session&card ◀───┤  union:
                                         ├─ ring.list(filters)            (live, ephemeral)
                                         └─ store.timelineEvents(limit)    (durable milestones)
                                         ▼
                          newest-first merged feed (client panel / modal / CLI)
```

## Progress (planned steps)

- [ ] **Ring buffer module** — `activity.js` with `createActivityRing({cap})` → `{append, list}`; pure,
      no I/O. Newest-first, bounded, filterable by `session`/`card`.
- [ ] **Store read** — `model.js#timelineEvents(limit)`: `SELECT` recent milestone events across cards.
      No migration.
- [ ] **Server routes** — `POST /api/activity` (append + claim-based card attribution) and
      `GET /api/timeline` (merge ring + milestones, apply filters, newest-first).
- [ ] **Extension shaping** — `core.ts#shapeActivity(...)` with truncation/curation + `core.test.ts`.
- [ ] **Extension effect + hooks** — `server.ts#postActivity(...)` (non-awaited, swallow errors) and the
      curated `pi.on(...)` registrations in `index.ts`; wire `attached.port`.
- [ ] **`/road activity` command** — extension command that GETs the timeline and renders it.
- [ ] **CLI `timeline`** — HTTP read via `.server.json`; graceful empty + note when no server.
- [ ] **Skill passthrough** — `roadmap.mjs` + `SKILL.md` row documenting server-dependence.
- [ ] **Client** — global Activity panel (header toggle, 2s poll) + per-card section in `CardModal`.
- [ ] **Styles** — activity rows, running/stalled/done states.
- [ ] **Tests** — `activity.test.js` (ring), `server.test.js` (new routes incl. attribution + merge),
      `core.test.ts` (shaping). 
- [ ] **Docs** — README + SKILL updates; note that `timeline` is the one read that needs a live server.

## Decision Log

- **Storage: ephemeral in-memory ring, not SQLite.** *(user-chosen)* Live activity is high-volume,
  short-lived session telemetry; persisting it would bloat the DB, demand a migration + retention policy,
  and churn the gitignored sqlite for no lasting value. The ring caps memory and is acceptable to lose on
  respawn. Trade-off accepted: CLI/skill reads can't see it (resolved by HTTP-only reads) and a respawn
  drops the live half (resolved by milestone merge).
- **HTTP-only timeline reads.** Because the ring is server-RAM, the `timeline` CLI/skill command is the
  sole read that bypasses the local store and talks to the live server, degrading to empty when none runs.
  Every other read stays SQLite-direct.
- **Merge ephemeral activity with durable milestones.** `GET /api/timeline` unions the ring with recent
  `card_claimed`/`card_released`/`card_moved` events from SQLite so the feed survives respawn instead of
  blanking. Milestones are already durable; this is a read, not a new write path.
- **Server-side card attribution via claim lookup.** The server tags each POSTed activity with the card
  whose `claimed_by === sessionId`. Keeps the extension dumb, ties the timeline to ROAD-024 claims, and
  makes per-card modal activity fall out for free. (Activity from an unclaimed session is global-only.)
- **Curated capture, fire-and-forget POST.** Capture a small lifecycle set (no `message_update`), send a
  truncated title + ok/error flag (never raw commands/contents/results), and never await the POST — the
  agent hot path must not slow down or fail because the board is slow/down.
- **No migration; `ROADMAP.md` unchanged.** Activity is transient session state, treated exactly like
  claims: present in the live UI and event log, excluded from the committed snapshot.

## Open questions

- **Stall detection.** "Running for a while with no follow-up" — compute client-side from the last
  event's age (e.g. running + age > N s → "stalled" badge), or have the server mark it? Leaning
  client-side (cheaper, no timers in the server); to confirm at execute time.
- **Ring cap.** ~200 events feels right for a single-project board; revisit if multi-session feeds feel
  truncated. Per-session sub-caps not planned unless one chatty session crowds others out.
- **Milestone window.** How far back should `timelineEvents(limit)` reach after a respawn? Start with the
  last ~50 milestone events; tune against real use.

## Out of scope

- Persisting activity across respawns (explicitly ephemeral by decision).
- Streaming/WebSocket push — the existing 2s poll is sufficient and consistent with the rest of the board.
- Capturing message/token streaming (`message_update`).
- Any change to `ROADMAP.md` generation or the committed snapshot.
- Cross-project / multi-board aggregation (one server per root stays the model).

## Outcomes

_(To be filled at execute time: what shipped, what surprised us, follow-ups.)_
