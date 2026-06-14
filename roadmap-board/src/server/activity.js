/**
 * Bounded in-memory activity ring buffer — the ephemeral half of the live timeline.
 *
 * Live agent activity is high-volume, short-lived session telemetry: useful while a
 * session is running, worthless once it's gone. So it lives here in the server process's
 * RAM and never in SQLite — no migration, no retention policy, no churn on the gitignored
 * DB. The trade-offs are deliberate (see the ROAD-025 plan):
 *
 *   1. A short-lived CLI/skill process opens its own SQLite connection and cannot see this
 *      buffer, so `timeline` reads go over HTTP to the live server instead.
 *   2. A server respawn (code edit, last-session detach) empties the ring; GET /api/timeline
 *      re-merges durable milestone events from SQLite so the feed survives rather than blanks.
 *
 * The ring is capped so a long-running, chatty session can't grow server memory without
 * bound — once full, each append drops the oldest event off the back.
 */

const DEFAULT_CAP = 200;

/**
 * Create an activity ring. `cap` bounds retained events (oldest evicted first). The ring
 * stamps a monotonic per-instance `seq` on every record so newest-first ordering stays
 * stable even when several events land in the same millisecond.
 */
export function createActivityRing({ cap = DEFAULT_CAP } = {}) {
  const buf = [];
  let seq = 0;

  return {
    /**
     * Append one activity record. The caller (server.js) is responsible for the durable
     * fields it owns — `ts` (receipt time) and `card_id` (claim attribution); this only
     * adds the stable `seq` and enforces the cap. Returns the stored record.
     */
    append(event) {
      const record = { seq: ++seq, ...event };
      buf.push(record);
      if (buf.length > cap) buf.splice(0, buf.length - cap);
      return record;
    },

    /**
     * Newest-first slice of the ring, optionally filtered by `session` and/or `card`.
     * `limit` caps the returned count (applied after filtering).
     */
    list({ limit = 50, session, card } = {}) {
      let rows = buf;
      if (session) rows = rows.filter((r) => r.session === session);
      if (card) rows = rows.filter((r) => r.card_id === card);
      // Take the most recent `limit` (the tail), then reverse so the result is newest-first.
      return rows.slice(Math.max(0, rows.length - limit)).reverse();
    },

    /** Current retained count (for tests/introspection). */
    get size() {
      return buf.length;
    },

    /** The configured cap (for tests/introspection). */
    get cap() {
      return cap;
    },
  };
}

/**
 * Merge the ephemeral activity ring with durable board-milestone events into one
 * newest-first feed, normalizing both into a single item shape so the client renders a
 * single list. This is the heart of "the feed survives a respawn": after a respawn the
 * ring is empty but `milestones` (from model.timelineEvents) still carries recent claims
 * and moves, so the timeline degrades to history instead of going blank.
 *
 *   - `activity`   — the ring's list() output ({seq, ts, session, kind, title, status, card_id}).
 *   - `milestones` — model.timelineEvents() output ({id, created_at, event_type, actor_type,
 *                    payload, card_id, card_title}).
 *   - `cardTitles` — card_id -> title map, used to enrich live activity items (the ring stores
 *                    only card_id, not the title, since titles can change after the event).
 *
 * Items are ordered by `ts` descending (ISO strings sort lexicographically); ties break by
 * the source's own ascending key (seq/id) in descending order for stable output.
 */
export function mergeTimeline(activity, milestones, { limit = 50, cardTitles } = {}) {
  const titles = cardTitles ?? new Map();

  const live = (activity ?? []).map((a) => ({
    source: 'activity',
    ts: a.ts,
    key: a.seq ?? 0,
    session: a.session ?? null,
    kind: a.kind,
    title: a.title ?? '',
    status: a.status ?? null,
    card_id: a.card_id ?? null,
    card_title: a.card_id ? (titles.get(a.card_id) ?? null) : null,
  }));

  const durable = (milestones ?? []).map((m) => ({
    source: 'milestone',
    ts: m.created_at,
    key: m.id ?? 0,
    actor_type: m.actor_type ?? null,
    kind: m.event_type,
    payload: m.payload ?? {},
    card_id: m.card_id ?? null,
    card_title: m.card_title ?? (m.card_id ? (titles.get(m.card_id) ?? null) : null),
  }));

  return [...live, ...durable]
    .sort((a, b) => {
      if (a.ts !== b.ts) return a.ts < b.ts ? 1 : -1; // newest first
      return (b.key ?? 0) - (a.key ?? 0);
    })
    .slice(0, limit);
}
