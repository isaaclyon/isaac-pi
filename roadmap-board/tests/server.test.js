import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startServer } from '../src/server/server.js';

// Boots the real Express app on an OS-assigned ephemeral port (port 0) so tests never
// collide on the default 4177, and exercises it over real HTTP with the global fetch.
// This deliberately mirrors model.test.js's withStore: zero extra dependencies, an
// isolated temp project root (and therefore an isolated SQLite DB) per test, and full
// teardown. The point is to prove the HTTP wiring — express.json() body parsing, :id
// param threading, the 'agent' actor each route passes to the model, and the error
// middleware that maps httpError(status) onto the response — not to re-test model.js.
async function withServer(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-board-server-'));
  const log = console.log;
  console.log = () => {}; // silence the per-boot "running at…" banner
  let server, store;
  try {
    ({ server, store } = await startServer({ projectRoot: dir, port: 0 }));
    console.log = log;
    const base = `http://127.0.0.1:${server.address().port}`;
    return await fn({ base, store });
  } finally {
    console.log = log;
    await new Promise(resolve => (server ? server.close(resolve) : resolve()));
    store?.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

async function req(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

test('GET /api/roadmap returns the full snapshot shape', () => withServer(async ({ base }) => {
  const { status, json } = await req(base, 'GET', '/api/roadmap');
  assert.equal(status, 200);
  assert.ok(Array.isArray(json.columns) && json.columns.length === 7);
  assert.ok(json.prompts && typeof json.prompts.plan === 'string');
  assert.deepEqual(json.epics, []);
  assert.deepEqual(json.cards, []);
}));

test('GET /api/cards/:id/events returns history and 404s on unknown ids', () => withServer(async ({ base, store }) => {
  const card = store.createTriage({ title: 'Trace me' });
  store.move(card.id, 'in_progress');

  const ok = await req(base, 'GET', `/api/cards/${card.id}/events`);
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.map(e => e.event_type), ['card_moved', 'card_created']);

  const missing = await req(base, 'GET', '/api/cards/ROAD-999/events');
  assert.equal(missing.status, 404);
  assert.match(missing.json.error, /Unknown card/);
}));

test('PATCH /api/cards/:id/agent persists edits as the agent and maps validation errors', () => withServer(async ({ base, store }) => {
  const a = store.createTriage({ title: 'A' });
  const b = store.createTriage({ title: 'B' });

  // Body is parsed by express.json() and threaded to store.agentUpdate.
  const ok = await req(base, 'PATCH', `/api/cards/${a.id}/agent`, { summary: 'Now detailed', depends_on: [b.id] });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.summary, 'Now detailed');
  assert.deepEqual(ok.json.depends_on, [b.id]);
  // Attributed to the 'agent' actor, verified through the persisted event trail.
  assert.equal(store.cardEvents(a.id)[0].actor_type, 'agent');

  const unknown = await req(base, 'PATCH', '/api/cards/ROAD-999/agent', { title: 'x' });
  assert.equal(unknown.status, 404);

  const selfLink = await req(base, 'PATCH', `/api/cards/${a.id}/agent`, { depends_on: [a.id] });
  assert.equal(selfLink.status, 400);
  assert.match(selfLink.json.error, /cannot link to itself/);

  // a already depends on b; making b depend on a would close a cycle.
  const cycle = await req(base, 'PATCH', `/api/cards/${b.id}/agent`, { depends_on: [a.id] });
  assert.equal(cycle.status, 400);
  assert.match(cycle.json.error, /dependency cycle/);
}));

test('POST /api/epics creates an epic and 400s without a title', () => withServer(async ({ base }) => {
  const ok = await req(base, 'POST', '/api/epics', { title: 'Robustness', summary: 'Tests' });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.id, 'EPIC-001');
  assert.equal(ok.json.total_count, 0);
  assert.equal(ok.json.percent_complete, 0);

  const bad = await req(base, 'POST', '/api/epics', { summary: 'no title' });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Title is required/);
}));

test('POST /api/epics/reorder sets the full epic order and 400s on partial lists', () => withServer(async ({ base, store }) => {
  const a = store.createEpic({ title: 'A' });
  const b = store.createEpic({ title: 'B' });
  const c = store.createEpic({ title: 'C' });

  const ok = await req(base, 'POST', '/api/epics/reorder', { ids: [c.id, a.id, b.id] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.map(e => e.id), [c.id, a.id, b.id]);
  assert.deepEqual(ok.json.map(e => e.sort_index), [0, 1, 2]);

  const partial = await req(base, 'POST', '/api/epics/reorder', { ids: [a.id, b.id] });
  assert.equal(partial.status, 400);
  assert.match(partial.json.error, /every current Epic/);
}));

test('PATCH /api/epics/:id patches fields and validates inputs', () => withServer(async ({ base, store }) => {
  const epic = store.createEpic({ title: 'Original' });

  const ok = await req(base, 'PATCH', `/api/epics/${epic.id}`, { title: 'Renamed', sort_index: 7 });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.title, 'Renamed');
  assert.equal(ok.json.sort_index, 7);

  const missing = await req(base, 'PATCH', '/api/epics/EPIC-999', { title: 'x' });
  assert.equal(missing.status, 404);

  const badIndex = await req(base, 'PATCH', `/api/epics/${epic.id}`, { sort_index: 1.5 });
  assert.equal(badIndex.status, 400);
  assert.match(badIndex.json.error, /sort_index must be an integer/);

  const unknownField = await req(base, 'PATCH', `/api/epics/${epic.id}`, { name: 'wrong key' });
  assert.equal(unknownField.status, 400);
  assert.match(unknownField.json.error, /Unknown epic field\(s\): name/);
}));

test('DELETE /api/epics/:id detaches member cards and 404s on unknown ids', () => withServer(async ({ base, store }) => {
  const epic = store.createEpic({ title: 'Doomed' });
  const card = store.createTriage({ title: 'Member' });
  store.assignEpic(card.id, epic.id);

  const ok = await req(base, 'DELETE', `/api/epics/${epic.id}`);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.deleted, true);
  assert.deepEqual(ok.json.detached, [card.id]);
  assert.equal(store.card(card.id).epic_id, null);

  const missing = await req(base, 'DELETE', '/api/epics/EPIC-999');
  assert.equal(missing.status, 404);
}));

test('POST /api/cards/:id/epic assigns, clears, and validates both ids', () => withServer(async ({ base, store }) => {
  const epic = store.createEpic({ title: 'Bucket' });
  const card = store.createTriage({ title: 'Card' });

  const assigned = await req(base, 'POST', `/api/cards/${card.id}/epic`, { epic_id: epic.id });
  assert.equal(assigned.status, 200);
  assert.equal(assigned.json.epic_id, epic.id);

  const cleared = await req(base, 'POST', `/api/cards/${card.id}/epic`, { epic_id: null });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.json.epic_id, null);

  const unknownCard = await req(base, 'POST', '/api/cards/ROAD-999/epic', { epic_id: epic.id });
  assert.equal(unknownCard.status, 404);
  assert.match(unknownCard.json.error, /Unknown card/);

  const unknownEpic = await req(base, 'POST', `/api/cards/${card.id}/epic`, { epic_id: 'EPIC-999' });
  assert.equal(unknownEpic.status, 404);
  assert.match(unknownEpic.json.error, /Unknown epic/);
}));

test('POST /api/cards/:id/move transitions columns and enforces move rules', () => withServer(async ({ base, store }) => {
  const card = store.createTriage({ title: 'Work' });

  const moved = await req(base, 'POST', `/api/cards/${card.id}/move`, { status: 'in_progress' });
  assert.equal(moved.status, 200);
  assert.equal(moved.json.status, 'in_progress');

  const blocked = await req(base, 'POST', `/api/cards/${card.id}/move`, { status: 'blocked', blocked_reason: 'Waiting on API' });
  assert.equal(blocked.status, 200);
  assert.equal(blocked.json.blocked_reason, 'Waiting on API');

  const badStatus = await req(base, 'POST', `/api/cards/${card.id}/move`, { status: 'nonsense' });
  assert.equal(badStatus.status, 400);
  assert.match(badStatus.json.error, /Invalid status/);

  const noReason = await req(base, 'POST', `/api/cards/${card.id}/move`, { status: 'blocked', blocked_reason: '' });
  assert.equal(noReason.status, 400);
  assert.match(noReason.json.error, /require a blocked_reason/);

  const missing = await req(base, 'POST', '/api/cards/ROAD-999/move', { status: 'up_next' });
  assert.equal(missing.status, 404);
}));
