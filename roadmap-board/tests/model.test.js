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

test('reorders all epics exactly once and rejects partial lists', () => withStore((store) => {
  const a = store.createEpic({ title: 'A' });
  const b = store.createEpic({ title: 'B' });
  const c = store.createEpic({ title: 'C' });

  // A full permutation rewrites sort_index densely from 0 and reorders epics() accordingly.
  const reordered = store.reorderEpics([c.id, a.id, b.id]);
  assert.deepEqual(reordered.map(e => e.id), [c.id, a.id, b.id]);
  assert.deepEqual(reordered.map(e => e.sort_index), [0, 1, 2]);
  assert.deepEqual(store.epics().map(e => e.id), [c.id, a.id, b.id]);

  // Must include every epic exactly once: a partial list or a duplicate is rejected, order unchanged.
  assert.throws(() => store.reorderEpics([a.id, b.id]), /every current Epic/);
  assert.throws(() => store.reorderEpics([a.id, a.id, b.id]), /every current Epic/);
  assert.throws(() => store.reorderEpics('not-an-array'), /ids must be an array/);
  assert.deepEqual(store.epics().map(e => e.id), [c.id, a.id, b.id]);
}));

test('dependencies and enablements must reference existing cards', () => withStore((store) => {
  const a = store.createTriage({ title: 'A' });
  const b = store.createTriage({ title: 'B' });
  assert.deepEqual(store.agentUpdate(a.id, { enables: [b.id] }).enables, [b.id]);
  assert.throws(() => store.agentUpdate(a.id, { depends_on: ['ROAD-999'] }), /Unknown card/);
}));

test('rejects depends_on/enables links that would form a dependency cycle', () => withStore((store) => {
  const a = store.createTriage({ title: 'A' });
  const b = store.createTriage({ title: 'B' });
  const c = store.createTriage({ title: 'C' });
  const d = store.createTriage({ title: 'D' });

  // Direct cycle: A depends on B, then B depends on A.
  store.agentUpdate(a.id, { depends_on: [b.id] });
  assert.throws(() => store.agentUpdate(b.id, { depends_on: [a.id] }), /dependency cycle/);

  // Transitive cycle across a chain: A -> B -> C, then C -> A.
  store.agentUpdate(b.id, { depends_on: [c.id] });
  assert.throws(() => store.agentUpdate(c.id, { depends_on: [a.id] }), /dependency cycle/);

  // enables is the inverse edge: with A -> B already, A enables B adds B -> A and closes the cycle.
  assert.throws(() => store.agentUpdate(a.id, { enables: [b.id] }), /dependency cycle/);

  // The rejected update is not persisted.
  assert.deepEqual(store.card(a.id).depends_on, [b.id]);
  assert.deepEqual(store.card(a.id).enables, []);

  // A non-cyclic link still succeeds (D depends on the existing A -> B -> C chain).
  assert.deepEqual(store.agentUpdate(d.id, { depends_on: [a.id] }).depends_on, [a.id]);
}));

test('derives ready-next from completed dependencies', () => withStore((store) => {
  const dep1 = store.createTriage({ title: 'Dep 1' });
  const dep2 = store.createTriage({ title: 'Dep 2' });
  const gated = store.createTriage({ title: 'Gated work' });
  const free = store.createTriage({ title: 'No-dep work' });
  store.agentUpdate(gated.id, { depends_on: [dep1.id, dep2.id] });

  // Gated by two incomplete deps -> not ready.
  assert.equal(store.card(gated.id).ready, false);
  // No dependencies -> never "ready next" (it was never waiting on anything).
  assert.equal(store.card(free.id).ready, false);

  // Completing only one dependency is not enough.
  store.move(dep1.id, 'completed');
  assert.equal(store.card(gated.id).ready, false);

  // Completing the last outstanding dependency flips it ready (liveness).
  store.move(dep2.id, 'completed');
  assert.equal(store.card(gated.id).ready, true);

  // A completed card is never ready, even with all deps completed.
  store.move(gated.id, 'completed');
  assert.equal(store.card(gated.id).ready, false);
}));

test('derives dependency-blocked as the inverse of ready, independent of blocked status', () => withStore((store) => {
  const dep1 = store.createTriage({ title: 'Dep 1' });
  const dep2 = store.createTriage({ title: 'Dep 2' });
  const gated = store.createTriage({ title: 'Gated work' });
  const free = store.createTriage({ title: 'No-dep work' });
  store.agentUpdate(gated.id, { depends_on: [dep1.id, dep2.id] });

  // Any incomplete dependency -> blocked, and never simultaneously ready.
  assert.equal(store.card(gated.id).dependency_blocked, true);
  assert.equal(store.card(gated.id).ready, false);
  // No dependencies -> never dependency-blocked (it was never waiting on anything).
  assert.equal(store.card(free.id).dependency_blocked, false);

  // One outstanding dependency is enough to keep it blocked.
  store.move(dep1.id, 'completed');
  assert.equal(store.card(gated.id).dependency_blocked, true);

  // Completing the last dependency flips blocked off and ready on (exact complement).
  store.move(dep2.id, 'completed');
  assert.equal(store.card(gated.id).dependency_blocked, false);
  assert.equal(store.card(gated.id).ready, true);

  // A completed card is never dependency-blocked, even with incomplete deps.
  const reopened = store.createTriage({ title: 'Reopened dep' });
  store.agentUpdate(gated.id, { depends_on: [reopened.id] });
  store.move(gated.id, 'completed');
  assert.equal(store.card(gated.id).dependency_blocked, false);
}));

test('dependency-blocked is orthogonal to the blocked status column', () => withStore((store) => {
  const dep = store.createTriage({ title: 'Dependency' });
  const waiting = store.createTriage({ title: 'Waiting on dep' });
  const manuallyBlocked = store.createTriage({ title: 'Manually blocked' });
  store.agentUpdate(waiting.id, { depends_on: [dep.id] });
  store.agentUpdate(manuallyBlocked.id, { depends_on: [dep.id] });

  // In the Blocked column for an unrelated reason but the dep is incomplete -> still dependency-blocked.
  store.move(manuallyBlocked.id, 'blocked', { blocked_reason: 'unrelated reason' });
  assert.equal(store.card(manuallyBlocked.id).dependency_blocked, true);

  // Completing the dep clears the derived flag even while it stays in the Blocked column.
  store.move(dep.id, 'completed');
  assert.equal(store.card(manuallyBlocked.id).dependency_blocked, false);
  assert.equal(store.card(manuallyBlocked.id).status, 'blocked');

  // dependencyBlockedCards returns exactly the derived set, regardless of column.
  assert.deepEqual(store.dependencyBlockedCards().map(c => c.id), []);
  const stillWaiting = store.createTriage({ title: 'Still waiting' });
  store.agentUpdate(stillWaiting.id, { depends_on: [waiting.id] });
  assert.deepEqual(store.dependencyBlockedCards().map(c => c.id).sort(), [stillWaiting.id].sort());
}));

test('readyCards returns exactly the ready set', () => withStore((store) => {
  const dep = store.createTriage({ title: 'Dependency' });
  const ready = store.createTriage({ title: 'Unblocked' });
  store.createTriage({ title: 'Free agent' }); // no deps -> excluded
  const stillGated = store.createTriage({ title: 'Still gated' });

  store.agentUpdate(ready.id, { depends_on: [dep.id] });
  store.agentUpdate(stillGated.id, { depends_on: [dep.id] });
  store.move(dep.id, 'completed');
  store.move(stillGated.id, 'blocked', { blocked_reason: 'unrelated reason' });

  // dep is completed, so `ready` is unblocked; stillGated is also unblocked by deps
  // (any non-completed status qualifies) -> both surface, free agent and dep do not.
  assert.deepEqual(store.readyCards().map(c => c.id).sort(), [ready.id, stillGated.id].sort());
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

test('deleting an epic detaches its cards and removes it from markdown', () => withStore((store, dir) => {
  const epic = store.createEpic({ title: 'Doomed epic', summary: 'Going away' });
  const cardA = store.createTriage({ title: 'A' });
  const cardB = store.createTriage({ title: 'B' });
  store.assignEpic(cardA.id, epic.id);
  store.assignEpic(cardB.id, epic.id);

  const result = store.deleteEpic(epic.id);
  assert.equal(result.deleted, true);
  assert.equal(result.id, epic.id);
  assert.deepEqual(result.detached.sort(), [cardA.id, cardB.id]);

  assert.deepEqual(store.epics(), []);
  assert.equal(store.card(cardA.id).epic_id, null);
  assert.equal(store.card(cardB.id).epic_id, null);

  const markdown = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
  assert.doesNotMatch(markdown, /Doomed epic/);
  assert.match(markdown, /## Epics\n\n_No epics\._/);
}));

test('deleting an unknown epic throws 404', () => withStore((store) => {
  assert.throws(() => store.deleteEpic('EPIC-999'), /Unknown epic/);
}));

// Read epic-scoped events (card_id IS NULL) directly; cardEvents() only surfaces card history.
function lastEpicEvent(store, epicId) {
  const row = store.db
    .prepare("SELECT event_type, payload FROM events WHERE card_id IS NULL AND json_extract(payload, '$.epic_id') = ? ORDER BY id DESC LIMIT 1")
    .get(epicId);
  return row ? { event_type: row.event_type, payload: JSON.parse(row.payload) } : null;
}

test('renaming an epic updates markdown and records the before/after title in the event', () => withStore((store, dir) => {
  const epic = store.createEpic({ title: 'Old name', summary: 'Keep me' });
  const renamed = store.updateEpic(epic.id, { title: 'New name' });
  assert.equal(renamed.title, 'New name');
  assert.equal(renamed.summary, 'Keep me'); // untouched fields survive

  const event = lastEpicEvent(store, epic.id);
  assert.equal(event.event_type, 'epic_updated');
  assert.deepEqual(event.payload.fields, ['title']);
  assert.equal(event.payload.renamed_from, 'Old name');
  assert.equal(event.payload.renamed_to, 'New name');

  const markdown = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
  assert.match(markdown, /New name/);
  assert.doesNotMatch(markdown, /Old name/);
}));

test('summary- and sort_index-only updates log just the changed field without a rename payload', () => withStore((store) => {
  const epic = store.createEpic({ title: 'Stable', summary: 'v1', sort_index: 3 });

  store.updateEpic(epic.id, { summary: 'v2' });
  let event = lastEpicEvent(store, epic.id);
  assert.deepEqual(event.payload.fields, ['summary']);
  assert.equal(event.payload.renamed_from, undefined);

  const reordered = store.updateEpic(epic.id, { sort_index: 9 });
  assert.equal(reordered.sort_index, 9);
  event = lastEpicEvent(store, epic.id);
  assert.deepEqual(event.payload.fields, ['sort_index']);
}));

test('a no-op epic update writes nothing — no event, no updated_at bump', () => withStore((store) => {
  const epic = store.createEpic({ title: 'Inert', summary: 'same' });
  const before = store.epic(epic.id).updated_at;
  const result = store.updateEpic(epic.id, { title: 'Inert', summary: 'same' });
  assert.equal(result.updated_at, before);
  // Only the creation event exists; the no-op added none.
  const count = store.db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE card_id IS NULL AND json_extract(payload, '$.epic_id') = ? AND event_type = 'epic_updated'")
    .get(epic.id).n;
  assert.equal(count, 0);
}));

test('updateEpic rejects unknown fields and blank titles, and 404s on unknown ids', () => withStore((store) => {
  const epic = store.createEpic({ title: 'Guarded' });
  assert.throws(() => store.updateEpic(epic.id, { name: 'typo' }), /Unknown epic field\(s\): name/);
  assert.throws(() => store.updateEpic(epic.id, { title: '   ' }), /Title is required/);
  assert.throws(() => store.updateEpic('EPIC-999', { title: 'x' }), /Unknown epic/);
}));

test('archiving an epic is reversible, non-destructive, and idempotent', () => withStore((store, dir) => {
  const epic = store.createEpic({ title: 'Shipped epic', summary: 'All done' });
  const card = store.createTriage({ title: 'A card' });
  store.assignEpic(card.id, epic.id);

  const archived = store.archiveEpic(epic.id);
  assert.ok(archived.archived_at, 'archived_at is stamped');
  assert.equal(lastEpicEvent(store, epic.id).event_type, 'epic_archived');
  // Card is untouched — archiving is purely an epic-display concern.
  assert.equal(store.card(card.id).epic_id, epic.id);
  // The epic still exists in the full snapshot; it's just flagged.
  assert.equal(store.epics().length, 1);

  // Dropped from the active ## Epics list, surfaced under ## Archived Epics.
  let markdown = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
  assert.match(markdown, /## Epics\n\n_No epics\._/);
  assert.match(markdown, /## Archived Epics\n\n- \*\*EPIC-001\*\* — Shipped epic/);

  // Idempotent: a second archive adds no event.
  const before = store.epic(epic.id).archived_at;
  store.archiveEpic(epic.id);
  const count = store.db
    .prepare("SELECT COUNT(*) AS n FROM events WHERE card_id IS NULL AND json_extract(payload, '$.epic_id') = ? AND event_type = 'epic_archived'")
    .get(epic.id).n;
  assert.equal(count, 1);
  assert.equal(store.epic(epic.id).archived_at, before);

  // Unarchive restores it to the active list and logs the inverse event.
  const restored = store.unarchiveEpic(epic.id);
  assert.equal(restored.archived_at, null);
  assert.equal(lastEpicEvent(store, epic.id).event_type, 'epic_unarchived');
  markdown = readFileSync(join(dir, 'ROADMAP.md'), 'utf8');
  assert.match(markdown, /## Epics\n\n- \*\*EPIC-001\*\* — Shipped epic/);
  assert.match(markdown, /## Archived Epics\n\n_No archived epics\._/);
}));

test('archive/unarchive 404 on unknown ids', () => withStore((store) => {
  assert.throws(() => store.archiveEpic('EPIC-999'), /Unknown epic/);
  assert.throws(() => store.unarchiveEpic('EPIC-999'), /Unknown epic/);
}));

test('is_complete is true only when every card is completed, and marks the epic with ✓ in markdown', () => withStore((store, dir) => {
  const epic = store.createEpic({ title: 'Two-card epic' });
  // Empty epic: never complete.
  assert.equal(store.epic(epic.id).is_complete, false);

  const a = store.createTriage({ title: 'A' });
  const b = store.createTriage({ title: 'B' });
  store.assignEpic(a.id, epic.id);
  store.assignEpic(b.id, epic.id);
  store.move(a.id, 'completed');
  // Partial: one of two done.
  assert.equal(store.epic(epic.id).is_complete, false);
  assert.doesNotMatch(readFileSync(join(dir, 'ROADMAP.md'), 'utf8'), /Two-card epic ✓/);

  store.move(b.id, 'completed');
  assert.equal(store.epic(epic.id).is_complete, true);
  assert.match(readFileSync(join(dir, 'ROADMAP.md'), 'utf8'), /\*\*EPIC-001\*\* — Two-card epic ✓/);
}));

test('returns per-card event history newest-first and excludes unrelated events', () => withStore((store) => {
  const card = store.createTriage({ title: 'Trace me' });
  store.move(card.id, 'in_progress');
  store.agentUpdate(card.id, { summary: 'Now with detail' });
  store.createEpic({ title: 'Unrelated epic' }); // card_id = NULL, must not appear

  const events = store.cardEvents(card.id);
  assert.deepEqual(events.map(e => e.event_type), ['card_updated', 'card_moved', 'card_created']);
  assert.equal(events.at(-1).payload.status, 'triage');
  assert.equal(events[1].payload.from, 'triage');
  assert.equal(events[1].payload.to, 'in_progress');
  assert.ok(events.every(e => e.event_type !== 'epic_created' && e.event_type !== 'markdown_exported'));

  assert.throws(() => store.cardEvents('ROAD-999'), /Unknown card/);
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
