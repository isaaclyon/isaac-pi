import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openRoadmap, paths, SCHEMA_VERSION } from '../src/server/model.js';

// These tests fabricate older / partial on-disk databases with a raw DatabaseSync, then prove
// openRoadmap drives each one forward to the current schema without losing data. The forward path
// must be idempotent: every board created before versioned migrations existed sits at
// user_version 0 with a full-but-unversioned schema, and re-opening it must converge on exactly
// the same shape as a brand-new DB.

// Create an empty project dir and return the path openRoadmap will use for its SQLite file.
function projectDir() {
  const dir = mkdtempSync(join(tmpdir(), 'roadmap-board-migrate-'));
  mkdirSync(paths(dir).dir, { recursive: true });
  return dir;
}

function userVersion(dir) {
  const db = new DatabaseSync(paths(dir).db);
  try { return Number(db.prepare('PRAGMA user_version').get().user_version); }
  finally { db.close(); }
}

function columnNames(db, table) {
  return db.prepare(`PRAGMA table_info(${table})`).all().map(c => c.name);
}

test('upgrades a partial pre-versioned schema, preserving existing rows', () => {
  const dir = projectDir();

  // A DB from an early build: cards table only, no epic_id, no meta, no events/epics, user_version 0.
  const seed = new DatabaseSync(paths(dir).db);
  seed.exec(`
    CREATE TABLE cards (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, depends_on TEXT NOT NULL DEFAULT '[]', enables TEXT NOT NULL DEFAULT '[]',
      blocked_reason TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  seed.prepare('INSERT INTO cards (id, title, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('ROAD-007', 'Legacy card', 'in_progress', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
  assert.equal(Number(seed.prepare('PRAGMA user_version').get().user_version), 0);
  seed.close();

  const store = openRoadmap(dir);
  try {
    // Schema is now complete: card metadata columns added, meta counters seeded, events/epics tables present.
    assert.ok(columnNames(store.db, 'cards').includes('epic_id'));
    assert.ok(columnNames(store.db, 'cards').includes('documents'));
    assert.equal(store.db.prepare('SELECT value FROM meta WHERE key = ?').get('next_card_number').value, '1');
    assert.equal(store.db.prepare('SELECT value FROM meta WHERE key = ?').get('next_epic_number').value, '1');
    // Pre-existing row survived the upgrade untouched, with epic_id defaulting to null.
    const card = store.card('ROAD-007');
    assert.equal(card.title, 'Legacy card');
    assert.equal(card.status, 'in_progress');
    assert.equal(card.epic_id, null);
    assert.deepEqual(card.documents, []);
    // The board is fully operational on top of the migrated schema.
    assert.equal(store.createTriage({ title: 'Post-migration card' }).id, 'ROAD-001');
  } finally {
    store.close();
  }
  assert.equal(userVersion(dir), SCHEMA_VERSION);
});

test('stamps a full but unversioned legacy DB without duplicating columns or losing data', () => {
  const dir = projectDir();

  // The common case: every column already exists (including epic_id, added ad-hoc by the old code)
  // but user_version was never set, so it reads as 0.
  const seed = new DatabaseSync(paths(dir).db);
  seed.exec(`
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE cards (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL, depends_on TEXT NOT NULL DEFAULT '[]', enables TEXT NOT NULL DEFAULT '[]',
      blocked_reason TEXT NOT NULL DEFAULT '', position INTEGER NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, epic_id TEXT
    );
    CREATE TABLE epics (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '',
      sort_index INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, card_id TEXT, event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
      payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL
    );
    INSERT INTO meta (key, value) VALUES ('next_card_number', '12'), ('next_epic_number', '3');
  `);
  seed.prepare('INSERT INTO cards (id, title, status, position, created_at, updated_at, epic_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run('ROAD-011', 'Pre-existing', 'review', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', null);
  seed.close();

  const store = openRoadmap(dir);
  try {
    // No duplicate metadata columns, existing meta counters untouched (not reset to 1).
    assert.equal(columnNames(store.db, 'cards').filter(n => n === 'epic_id').length, 1);
    assert.equal(columnNames(store.db, 'cards').filter(n => n === 'documents').length, 1);
    assert.equal(store.db.prepare('SELECT value FROM meta WHERE key = ?').get('next_card_number').value, '12');
    assert.equal(store.card('ROAD-011').title, 'Pre-existing');
    assert.deepEqual(store.card('ROAD-011').documents, []);
    // The preserved counter is honoured: the next card is ROAD-012, not a re-issued low id.
    assert.equal(store.createTriage({ title: 'Next' }).id, 'ROAD-012');
  } finally {
    store.close();
  }
  assert.equal(userVersion(dir), SCHEMA_VERSION);
});

test('a fresh DB lands directly on the current schema version', () => {
  const dir = projectDir();
  const store = openRoadmap(dir);
  try {
    assert.ok(columnNames(store.db, 'cards').includes('epic_id'));
    assert.ok(columnNames(store.db, 'cards').includes('documents'));
  } finally {
    store.close();
  }
  assert.equal(userVersion(dir), SCHEMA_VERSION);
});

test('re-opening an already-current DB is a no-op (idempotent migration)', () => {
  const dir = projectDir();
  openRoadmap(dir).close();
  assert.equal(userVersion(dir), SCHEMA_VERSION);

  // Second open must not re-run any step, error, or change the version.
  const store = openRoadmap(dir);
  try {
    assert.equal(Number(store.db.prepare('PRAGMA user_version').get().user_version), SCHEMA_VERSION);
  } finally {
    store.close();
  }
  assert.equal(userVersion(dir), SCHEMA_VERSION);
});

test('a thrown mutation rolls back atomically — no partial rows, no burned ids', () => {
  const dir = projectDir();
  const store = openRoadmap(dir);
  try {
    const committed = store.createTriage({ title: 'Committed' });
    assert.equal(committed.id, 'ROAD-001');

    // A transaction that allocates an id and writes a row, then throws, must leave no trace:
    // the row is rolled back AND the id counter is restored, so no ROAD number is consumed.
    assert.throws(() => store.tx(() => {
      const id = store.nextId();
      store.db.prepare('INSERT INTO cards (id, title, status, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(id, 'Doomed', 'triage', 99, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
      throw new Error('boom');
    }), /boom/);

    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n, 1);
    // The next real create reuses ROAD-002, proving the failed transaction did not burn an id.
    assert.equal(store.createTriage({ title: 'After failure' }).id, 'ROAD-002');
  } finally {
    store.close();
  }
});

test('nested tx() joins the outer transaction instead of issuing a nested BEGIN', () => {
  const dir = projectDir();
  const store = openRoadmap(dir);
  try {
    // createTriage already runs inside tx(); calling it from within an outer tx() must not throw
    // "cannot start a transaction within a transaction" — the inner call joins the open one.
    const result = store.tx(() => {
      const a = store.createTriage({ title: 'Inner A' });
      const b = store.createTriage({ title: 'Inner B' });
      return [a.id, b.id];
    });
    assert.deepEqual(result, ['ROAD-001', 'ROAD-002']);
    assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM cards').get().n, 2);
  } finally {
    store.close();
  }
});
