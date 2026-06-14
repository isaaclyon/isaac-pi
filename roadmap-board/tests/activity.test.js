import test from 'node:test';
import assert from 'node:assert/strict';
import { createActivityRing, mergeTimeline } from '../src/server/activity.js';

// The ring is the ephemeral half of the live timeline: a bounded, newest-first, filterable
// in-RAM buffer. These tests pin the cap eviction, the seq monotonicity that keeps ordering
// stable, and the session/card filters the routes lean on. mergeTimeline is the pure union
// of that ring with durable milestone events — the logic that lets the feed survive a respawn.

test('append stamps a monotonic seq and returns the stored record', () => {
  const ring = createActivityRing({ cap: 10 });
  const a = ring.append({ kind: 'agent_start', title: 'A', ts: '2026-06-13T00:00:00.000Z' });
  const b = ring.append({ kind: 'agent_end', title: 'B', ts: '2026-06-13T00:00:01.000Z' });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(b.kind, 'agent_end');
  assert.equal(ring.size, 2);
});

test('list returns newest-first and honors the limit', () => {
  const ring = createActivityRing({ cap: 10 });
  for (let i = 0; i < 5; i++) ring.append({ kind: 'tool_start', title: `t${i}`, ts: `2026-06-13T00:00:0${i}.000Z` });
  const recent = ring.list({ limit: 3 });
  assert.deepEqual(recent.map(r => r.title), ['t4', 't3', 't2']);
});

test('cap evicts the oldest events once full', () => {
  const ring = createActivityRing({ cap: 3 });
  for (let i = 0; i < 6; i++) ring.append({ kind: 'tick', title: `n${i}`, ts: `2026-06-13T00:00:0${i}.000Z` });
  assert.equal(ring.size, 3);
  assert.deepEqual(ring.list({ limit: 10 }).map(r => r.title), ['n5', 'n4', 'n3']);
});

test('list filters by session and by card', () => {
  const ring = createActivityRing();
  ring.append({ kind: 'agent_start', session: 's1', card_id: 'ROAD-1', ts: '2026-06-13T00:00:00.000Z' });
  ring.append({ kind: 'agent_start', session: 's2', card_id: 'ROAD-2', ts: '2026-06-13T00:00:01.000Z' });
  ring.append({ kind: 'tool_start', session: 's1', card_id: null, ts: '2026-06-13T00:00:02.000Z' });

  assert.deepEqual(ring.list({ session: 's1' }).map(r => r.kind), ['tool_start', 'agent_start']);
  assert.deepEqual(ring.list({ card: 'ROAD-2' }).map(r => r.session), ['s2']);
});

test('mergeTimeline unions live activity with durable milestones, newest-first', () => {
  const live = [
    { seq: 2, ts: '2026-06-13T00:00:05.000Z', session: 's1', kind: 'tool_start', title: 'grep', status: 'running', card_id: 'ROAD-1' },
    { seq: 1, ts: '2026-06-13T00:00:01.000Z', session: 's1', kind: 'agent_start', title: 'started', status: 'running', card_id: 'ROAD-1' },
  ];
  const milestones = [
    { id: 9, created_at: '2026-06-13T00:00:03.000Z', event_type: 'card_claimed', actor_type: 'agent', payload: { owner: 's1' }, card_id: 'ROAD-1', card_title: 'Build it' },
  ];
  const merged = mergeTimeline(live, milestones, { limit: 10, cardTitles: new Map([['ROAD-1', 'Build it']]) });

  assert.deepEqual(merged.map(m => [m.source, m.kind]), [
    ['activity', 'tool_start'],   // 00:00:05 newest
    ['milestone', 'card_claimed'], // 00:00:03
    ['activity', 'agent_start'],   // 00:00:01 oldest
  ]);
  // Live items get their title enriched from the card-title map.
  assert.equal(merged[0].card_title, 'Build it');
});

test('mergeTimeline breaks same-timestamp ties by descending source key', () => {
  const live = [
    { seq: 1, ts: '2026-06-13T00:00:00.000Z', kind: 'a', card_id: null },
    { seq: 2, ts: '2026-06-13T00:00:00.000Z', kind: 'b', card_id: null },
  ];
  const merged = mergeTimeline(live, [], { limit: 10 });
  assert.deepEqual(merged.map(m => m.kind), ['b', 'a']);
});

test('mergeTimeline respects the limit across both sources', () => {
  const live = Array.from({ length: 5 }, (_, i) => ({ seq: i + 1, ts: `2026-06-13T00:00:1${i}.000Z`, kind: 'live', card_id: null }));
  const milestones = Array.from({ length: 5 }, (_, i) => ({ id: i + 1, created_at: `2026-06-13T00:00:0${i}.000Z`, event_type: 'card_moved', card_id: 'ROAD-1' }));
  const merged = mergeTimeline(live, milestones, { limit: 4 });
  assert.equal(merged.length, 4);
  // The 4 newest are all the live items (10s+) ahead of the milestones (0s).
  assert.deepEqual(merged.map(m => m.source), ['activity', 'activity', 'activity', 'activity']);
});
