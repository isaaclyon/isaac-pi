import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openRoadmap } from '../src/server/model.js';

function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-board-'));
  const store = openRoadmap(dir);
  try { return fn(store, dir); }
  finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}

test('creates Triage cards with sequential immutable IDs and exports markdown', () => withStore((store, dir) => {
  const first = store.createTriage({ title: 'First idea' });
  const second = store.createTriage({ title: 'Second idea', summary: 'More context' });
  assert.equal(first.id, 'ROAD-001');
  assert.equal(second.id, 'ROAD-002');
  assert.equal(second.status, 'triage');
  const markdown = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
  assert.match(markdown, /Generated from `.pi\/roadmap\/roadmap.sqlite`/);
  assert.match(markdown, /\*\*ROAD-002\*\* — Second idea/);
}));

test('users cannot update non-Triage cards, but agents can', () => withStore((store) => {
  const card = store.createTriage({ title: 'Implement board' });
  store.move(card.id, 'in_progress');
  assert.throws(() => store.updateTriage(card.id, { title: 'User edit' }), /Users can edit only Triage/);
  const updated = store.agentUpdate(card.id, { title: 'Agent edit', summary: 'Done by agent' });
  assert.equal(updated.title, 'Agent edit');
}));

test('blocked cards require a blocked reason', () => withStore((store) => {
  const card = store.createTriage({ title: 'Needs API' });
  assert.throws(() => store.move(card.id, 'blocked'), /blocked_reason/);
  assert.equal(store.move(card.id, 'blocked', { blocked_reason: 'Waiting on API' }).blocked_reason, 'Waiting on API');
}));

test('reorders all Triage cards exactly once', () => withStore((store) => {
  const a = store.createTriage({ title: 'A' });
  const b = store.createTriage({ title: 'B' });
  store.reorderTriage([b.id, a.id]);
  assert.deepEqual(store.cards().filter(c => c.status === 'triage').sort((x, y) => x.position - y.position).map(c => c.id), [b.id, a.id]);
  assert.throws(() => store.reorderTriage([a.id]), /every current Triage card/);
}));

test('dependencies and enablements must reference existing cards', () => withStore((store) => {
  const a = store.createTriage({ title: 'A' });
  const b = store.createTriage({ title: 'B' });
  assert.deepEqual(store.agentUpdate(a.id, { enables: [b.id] }).enables, [b.id]);
  assert.throws(() => store.agentUpdate(a.id, { depends_on: ['ROAD-999'] }), /Unknown card/);
}));

test('users can delete Triage cards but not cards in other columns', () => withStore((store, dir) => {
  const triaged = store.createTriage({ title: 'Disposable idea' });
  const result = store.deleteCard(triaged.id, 'user');
  assert.deepEqual(result, { id: triaged.id, deleted: true, status: 'triage' });
  assert.throws(() => store.card(triaged.id), /Unknown card/);
  const markdown = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
  assert.doesNotMatch(markdown, /Disposable idea/);

  const active = store.createTriage({ title: 'Real work' });
  store.move(active.id, 'in_progress');
  assert.throws(() => store.deleteCard(active.id, 'user'), /Users can delete only Triage/);
}));

test('agents can delete cards in any column', () => withStore((store) => {
  const card = store.createTriage({ title: 'Superseded work' });
  store.move(card.id, 'in_progress');
  assert.equal(store.deleteCard(card.id, 'agent').deleted, true);
  assert.throws(() => store.card(card.id), /Unknown card/);
}));

test('deleting a card strips dangling depends_on/enables references', () => withStore((store) => {
  const a = store.createTriage({ title: 'A' });
  const b = store.createTriage({ title: 'B' });
  store.agentUpdate(a.id, { depends_on: [b.id] });
  store.agentUpdate(b.id, { enables: [a.id] });
  store.deleteCard(b.id, 'agent');
  assert.deepEqual(store.card(a.id).depends_on, []);
}));

test('creates epics with sequential IDs, stable ordering, and derived progress', () => withStore((store) => {
  const later = store.createEpic({ title: 'Later epic', sort_index: 20 });
  const first = store.createEpic({ title: 'First epic', summary: 'Start here', sort_index: 5 });
  assert.equal(later.id, 'EPIC-001');
  assert.equal(first.id, 'EPIC-002');

  const cardA = store.createTriage({ title: 'A' });
  const cardB = store.createTriage({ title: 'B' });
  store.assignEpic(cardA.id, first.id);
  store.assignEpic(cardB.id, first.id);
  store.move(cardA.id, 'completed');

  const epics = store.epics();
  assert.deepEqual(epics.map(epic => epic.id), [first.id, later.id]);
  assert.equal(epics[0].done_count, 1);
  assert.equal(epics[0].total_count, 2);
  assert.equal(epics[0].percent_complete, 50);
  assert.deepEqual(epics[0].card_ids.sort(), [cardA.id, cardB.id]);
}));

test('assigns and clears epic membership and exports epic details to markdown', () => withStore((store, dir) => {
  const epic = store.createEpic({ title: 'Roadmap UX', summary: 'Improve grouping' });
  const card = store.createTriage({ title: 'Add epic rail' });

  assert.equal(store.assignEpic(card.id, epic.id).epic_id, epic.id);
  assert.equal(store.assignEpic(card.id, null).epic_id, null);
  store.assignEpic(card.id, epic.id);

  const markdown = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
  assert.match(markdown, /## Epics/);
  assert.match(markdown, /\*\*EPIC-001\*\* — Roadmap UX/);
  assert.match(markdown, /Progress: 0 \/ 1 \(0%\)/);
  assert.match(markdown, /Cards: ROAD-001/);
  assert.match(markdown, /Epic: EPIC-001/);
}));

test('migrates existing databases forward without losing cards', () => {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-board-migrate-'));
  const dbPath = join(dir, '.pi', 'roadmap', 'roadmap.sqlite');
  mkdirSync(join(dir, '.pi', 'roadmap'), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      depends_on TEXT NOT NULL DEFAULT '[]',
      enables TEXT NOT NULL DEFAULT '[]',
      blocked_reason TEXT NOT NULL DEFAULT '',
      position INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('next_card_number', '2');
  db.prepare(`INSERT INTO cards (id, title, summary, status, depends_on, enables, blocked_reason, position, created_at, updated_at)
    VALUES (?, ?, ?, ?, '[]', '[]', '', ?, ?, ?)`)
    .run('ROAD-001', 'Legacy card', '', 'triage', 0, '2026-06-12T00:00:00.000Z', '2026-06-12T00:00:00.000Z');
  db.close();

  const store = openRoadmap(dir);
  try {
    assert.equal(store.card('ROAD-001').title, 'Legacy card');
    const epic = store.createEpic({ title: 'Migrated epic' });
    assert.equal(epic.id, 'EPIC-001');
    assert.equal(store.assignEpic('ROAD-001', epic.id).epic_id, epic.id);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
