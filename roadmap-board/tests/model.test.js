import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
