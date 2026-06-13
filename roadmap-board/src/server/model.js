import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export const COLUMNS = [
  { key: 'triage', label: 'Triage' },
  { key: 'backlog', label: 'Backlog' },
  { key: 'up_next', label: 'Up next' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'blocked', label: 'Blocked' },
  { key: 'review', label: 'Review' },
  { key: 'completed', label: 'Completed' },
];

export const PROMPT_ACTIONS = ['brainstorm', 'plan', 'execute', 'review'];
export const DEFAULT_PROMPTS = {
  brainstorm: 'Brainstorm roadmap card {{id}}. Read the card from the roadmap board, sharpen the idea in place, and do not plan or execute yet.',
  plan: 'Plan roadmap card {{id}}. Read the card from the roadmap board, inspect the repo, and produce an implementation plan without executing it yet.',
  execute: 'Execute roadmap card {{id}}. Read the card from the roadmap board, implement it, validate it, update the board, and export the generated roadmap.',
  review: 'Review roadmap card {{id}}. Read the card from the roadmap board and review the implementation against the card before completion.',
};

const VALID = new Set(COLUMNS.map(c => c.key));

export function paths(projectRoot = process.cwd()) {
  const root = resolve(projectRoot);
  const dir = join(root, '.pi', 'roadmap');
  return {
    root,
    dir,
    db: join(dir, 'roadmap.sqlite'),
    prompts: join(dir, 'prompts.json'),
    markdown: join(root, 'ROADMAP.md'),
  };
}

export function openRoadmap(projectRoot = process.cwd()) {
  const p = paths(projectRoot);
  mkdirSync(p.dir, { recursive: true });
  const db = new DatabaseSync(p.db);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS cards (
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
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT,
      event_type TEXT NOT NULL,
      actor_type TEXT NOT NULL CHECK (actor_type IN ('user','agent','system')),
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
  `);
  const count = db.prepare('SELECT COUNT(*) AS count FROM meta WHERE key = ?').get('next_card_number').count;
  if (count === 0) db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run('next_card_number', '1');
  ensurePrompts(p.prompts);
  return new RoadmapStore(db, p);
}

function ensurePrompts(file) {
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(DEFAULT_PROMPTS, null, 2) + '\n');
  }
}

function now() { return new Date().toISOString(); }
function parseList(value) { return JSON.parse(value || '[]'); }
function stringifyList(value) { return JSON.stringify(value ?? []); }
function assertStatus(status) { if (!VALID.has(status)) throw httpError(400, `Invalid status: ${status}`); }
function assertActor(actor) { if (!['user', 'agent', 'system'].includes(actor)) throw httpError(400, `Invalid actor: ${actor}`); }
export function httpError(status, message) { const e = new Error(message); e.status = status; return e; }

export class RoadmapStore {
  constructor(db, p) { this.db = db; this.paths = p; }
  close() { this.db.close(); }

  init() { this.exportMarkdown('system'); return this.snapshot(); }
  nextId() {
    const n = Number(this.db.prepare('SELECT value FROM meta WHERE key = ?').get('next_card_number').value);
    this.db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(n + 1), 'next_card_number');
    return `ROAD-${String(n).padStart(3, '0')}`;
  }
  prompts() { return JSON.parse(readFileSync(this.paths.prompts, 'utf8')); }
  columns() { return COLUMNS; }
  snapshot() { return { columns: COLUMNS, prompts: this.prompts(), cards: this.cards() }; }
  cards() {
    return this.db.prepare('SELECT * FROM cards ORDER BY status, position, created_at').all().map(row => ({
      ...row,
      depends_on: parseList(row.depends_on),
      enables: parseList(row.enables),
    }));
  }
  card(id) {
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
    if (!row) throw httpError(404, `Unknown card: ${id}`);
    return { ...row, depends_on: parseList(row.depends_on), enables: parseList(row.enables) };
  }
  event(cardId, eventType, actorType, payload = {}) {
    assertActor(actorType);
    this.db.prepare('INSERT INTO events (card_id, event_type, actor_type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(cardId, eventType, actorType, JSON.stringify(payload), now());
  }
  maxPosition(status) {
    return Number(this.db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM cards WHERE status = ?').get(status).max);
  }
  createTriage({ title, summary = '' }, actor = 'user') {
    if (!title || !title.trim()) throw httpError(400, 'Title is required');
    const id = this.nextId();
    const t = now();
    this.db.prepare(`INSERT INTO cards (id, title, summary, status, position, created_at, updated_at) VALUES (?, ?, ?, 'triage', ?, ?, ?)`) 
      .run(id, title.trim(), summary.trim(), this.maxPosition('triage') + 1, t, t);
    this.event(id, 'card_created', actor, { status: 'triage' });
    this.exportMarkdown('system');
    return this.card(id);
  }
  updateTriage(id, { title, summary }, actor = 'user') {
    const card = this.card(id);
    if (card.status !== 'triage') throw httpError(403, 'Users can edit only Triage cards');
    const nextTitle = title === undefined ? card.title : String(title).trim();
    if (!nextTitle) throw httpError(400, 'Title is required');
    const nextSummary = summary === undefined ? card.summary : String(summary).trim();
    this.db.prepare('UPDATE cards SET title = ?, summary = ?, updated_at = ? WHERE id = ?').run(nextTitle, nextSummary, now(), id);
    this.event(id, 'card_updated', actor, { fields: ['title', 'summary'] });
    this.exportMarkdown('system');
    return this.card(id);
  }
  agentUpdate(id, patch, actor = 'agent') {
    const card = this.card(id);
    const next = {
      title: patch.title === undefined ? card.title : String(patch.title).trim(),
      summary: patch.summary === undefined ? card.summary : String(patch.summary).trim(),
      depends_on: patch.depends_on === undefined ? card.depends_on : this.validateCardIds(patch.depends_on, id),
      enables: patch.enables === undefined ? card.enables : this.validateCardIds(patch.enables, id),
      blocked_reason: patch.blocked_reason === undefined ? card.blocked_reason : String(patch.blocked_reason).trim(),
    };
    if (!next.title) throw httpError(400, 'Title is required');
    this.db.prepare('UPDATE cards SET title = ?, summary = ?, depends_on = ?, enables = ?, blocked_reason = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.summary, stringifyList(next.depends_on), stringifyList(next.enables), next.blocked_reason, now(), id);
    this.event(id, 'card_updated', actor, { fields: Object.keys(patch) });
    this.exportMarkdown('system');
    return this.card(id);
  }
  move(id, status, { blocked_reason } = {}, actor = 'agent') {
    assertStatus(status);
    const card = this.card(id);
    const reason = blocked_reason === undefined ? card.blocked_reason : String(blocked_reason).trim();
    if (status === 'blocked' && !reason) throw httpError(400, 'Blocked cards require a blocked_reason');
    this.db.prepare('UPDATE cards SET status = ?, position = ?, blocked_reason = ?, updated_at = ? WHERE id = ?')
      .run(status, this.maxPosition(status) + 1, reason, now(), id);
    this.event(id, 'card_moved', actor, { from: card.status, to: status });
    this.exportMarkdown('system');
    return this.card(id);
  }
  reorderTriage(ids, actor = 'user') {
    if (!Array.isArray(ids)) throw httpError(400, 'ids must be an array');
    const triageIds = this.cards().filter(c => c.status === 'triage').map(c => c.id);
    if (new Set(ids).size !== ids.length || ids.length !== triageIds.length || !triageIds.every(id => ids.includes(id))) {
      throw httpError(400, 'Reorder must include every current Triage card exactly once');
    }
    const stmt = this.db.prepare('UPDATE cards SET position = ?, updated_at = ? WHERE id = ? AND status = \'triage\'');
    const t = now();
    ids.forEach((id, i) => stmt.run(i, t, id));
    this.event(null, 'triage_reordered', actor, { ids });
    this.exportMarkdown('system');
    return this.cards().filter(c => c.status === 'triage');
  }
  validateCardIds(ids, selfId) {
    if (!Array.isArray(ids)) throw httpError(400, 'Card links must be arrays of Card IDs');
    return ids.map(id => {
      const v = String(id).trim();
      if (v === selfId) throw httpError(400, 'A card cannot link to itself');
      this.card(v);
      return v;
    });
  }
  exportMarkdown(actor = 'system') {
    const byStatus = new Map(COLUMNS.map(c => [c.key, []]));
    for (const card of this.cards()) byStatus.get(card.status)?.push(card);
    const lines = ['# Roadmap', '', '> Generated from `.pi/roadmap/roadmap.sqlite`. Do not edit directly.', ''];
    for (const col of COLUMNS) {
      lines.push(`## ${col.label}`, '');
      const cards = byStatus.get(col.key) ?? [];
      if (cards.length === 0) { lines.push('_No cards._', ''); continue; }
      for (const card of cards) {
        lines.push(`- **${card.id}** — ${card.title}`);
        if (card.summary) lines.push(`  - Summary: ${card.summary}`);
        if (card.depends_on.length) lines.push(`  - Depends on: ${card.depends_on.join(', ')}`);
        if (card.enables.length) lines.push(`  - Enables: ${card.enables.join(', ')}`);
        if (card.blocked_reason) lines.push(`  - Blocked reason: ${card.blocked_reason}`);
      }
      lines.push('');
    }
    writeFileSync(this.paths.markdown, lines.join('\n'));
    this.event(null, 'markdown_exported', actor, { path: 'ROADMAP.md' });
    return this.paths.markdown;
  }
}
