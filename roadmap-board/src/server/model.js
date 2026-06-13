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
  refine: 'Refine roadmap card {{id}} ({{title}}). Read the card from the roadmap board, then apply this specific adjustment: {{direction}}. Update the card in place and export the generated roadmap.',
};

const VALID = new Set(COLUMNS.map(c => c.key));
const ACTORS = new Set(['user', 'agent', 'system']);

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
    CREATE TABLE IF NOT EXISTS epics (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      sort_index INTEGER NOT NULL,
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
  ensureColumn(db, 'cards', 'epic_id', 'ALTER TABLE cards ADD COLUMN epic_id TEXT');
  ensureMeta(db, 'next_card_number', '1');
  ensureMeta(db, 'next_epic_number', '1');
  ensurePrompts(p.prompts);
  return new RoadmapStore(db, p);
}

function ensureColumn(db, table, column, sql) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some(entry => entry.name === column)) db.exec(sql);
}

function ensureMeta(db, key, value) {
  const row = db.prepare('SELECT COUNT(*) AS count FROM meta WHERE key = ?').get(key);
  if (Number(row.count) === 0) db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)').run(key, value);
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
function assertActor(actor) { if (!ACTORS.has(actor)) throw httpError(400, `Invalid actor: ${actor}`); }
function normalizeText(value) { return String(value ?? '').trim(); }
function normalizeOptionalId(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}
function normalizeSortIndex(value) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw httpError(400, 'sort_index must be an integer');
  return number;
}
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

  nextEpicId() {
    const n = Number(this.db.prepare('SELECT value FROM meta WHERE key = ?').get('next_epic_number').value);
    this.db.prepare('UPDATE meta SET value = ? WHERE key = ?').run(String(n + 1), 'next_epic_number');
    return `EPIC-${String(n).padStart(3, '0')}`;
  }

  prompts() { return { ...DEFAULT_PROMPTS, ...JSON.parse(readFileSync(this.paths.prompts, 'utf8')) }; }
  columns() { return COLUMNS; }
  snapshot() { return { columns: COLUMNS, prompts: this.prompts(), epics: this.epics(), cards: this.cards() }; }

  cards() {
    const statusById = this.statusById();
    return this.db.prepare('SELECT * FROM cards ORDER BY status, position, created_at').all().map(row => this.hydrateCard(row, statusById));
  }

  card(id) {
    const row = this.db.prepare('SELECT * FROM cards WHERE id = ?').get(id);
    if (!row) throw httpError(404, `Unknown card: ${id}`);
    return this.hydrateCard(row, this.statusById());
  }

  // Map of every card id -> status. Readiness is a cross-card signal (a card's state
  // depends on the status of its dependency targets), so we resolve the whole board's
  // statuses once instead of issuing a query per dependency.
  statusById() {
    return new Map(this.db.prepare('SELECT id, status FROM cards').all().map(row => [row.id, row.status]));
  }

  hydrateCard(row, statusById) {
    const card = {
      ...row,
      epic_id: row.epic_id ?? null,
      depends_on: parseList(row.depends_on),
      enables: parseList(row.enables),
    };
    card.ready = statusById ? this.isReady(card, statusById) : false;
    card.dependency_blocked = statusById ? this.isDependencyBlocked(card, statusById) : false;
    return card;
  }

  // "Ready next" = the card was gated by dependencies and all of them are now completed,
  // while the card itself isn't completed. Cards with no dependencies are never ready —
  // they were never waiting on anything (this is the inverse of the dependency-blocked
  // signal). A dangling/unknown dependency id resolves to undefined !== 'completed', so
  // it correctly keeps the card unready.
  isReady(card, statusById) {
    if (card.status === 'completed' || card.depends_on.length === 0) return false;
    return card.depends_on.every(id => statusById.get(id) === 'completed');
  }

  // Inverse of readiness, and deliberately orthogonal to the `blocked` *status* column: a card is
  // dependency-blocked when it has dependencies, at least one isn't completed, and the card itself
  // isn't completed. A card can be dependency-blocked in any column (backlog, up next, in progress)
  // while a card in the Blocked column may carry an unrelated manual reason — the two are distinct
  // signals. A dangling/unknown dependency id resolves to undefined !== 'completed', so it keeps the
  // card blocked, matching how isReady treats unknown ids.
  isDependencyBlocked(card, statusById) {
    if (card.status === 'completed' || card.depends_on.length === 0) return false;
    return card.depends_on.some(id => statusById.get(id) !== 'completed');
  }

  readyCards() {
    return this.cards().filter(card => card.ready);
  }

  dependencyBlockedCards() {
    return this.cards().filter(card => card.dependency_blocked);
  }

  epics() {
    const epicRows = this.db.prepare('SELECT * FROM epics ORDER BY sort_index, id').all();
    const cardsByEpic = new Map();
    for (const card of this.cards()) {
      if (!card.epic_id) continue;
      if (!cardsByEpic.has(card.epic_id)) cardsByEpic.set(card.epic_id, []);
      cardsByEpic.get(card.epic_id).push(card);
    }
    return epicRows.map(row => this.hydrateEpic(row, cardsByEpic.get(row.id) ?? []));
  }

  epic(id) {
    const row = this.db.prepare('SELECT * FROM epics WHERE id = ?').get(id);
    if (!row) throw httpError(404, `Unknown epic: ${id}`);
    const cards = this.cards().filter(card => card.epic_id === id);
    return this.hydrateEpic(row, cards);
  }

  hydrateEpic(row, cards) {
    const doneCount = cards.filter(card => card.status === 'completed').length;
    const totalCount = cards.length;
    const percentComplete = totalCount === 0 ? 0 : Math.round((doneCount / totalCount) * 100);
    return {
      ...row,
      card_ids: cards.map(card => card.id),
      done_count: doneCount,
      total_count: totalCount,
      percent_complete: percentComplete,
    };
  }

  cardEvents(id) {
    this.card(id);
    return this.db
      .prepare('SELECT id, event_type, actor_type, payload, created_at FROM events WHERE card_id = ? ORDER BY id DESC')
      .all(id)
      .map(row => ({ ...row, payload: JSON.parse(row.payload || '{}') }));
  }

  event(cardId, eventType, actorType, payload = {}) {
    assertActor(actorType);
    this.db.prepare('INSERT INTO events (card_id, event_type, actor_type, payload, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(cardId, eventType, actorType, JSON.stringify(payload), now());
  }

  maxPosition(status) {
    return Number(this.db.prepare('SELECT COALESCE(MAX(position), -1) AS max FROM cards WHERE status = ?').get(status).max);
  }

  maxEpicSortIndex() {
    return Number(this.db.prepare('SELECT COALESCE(MAX(sort_index), -1) AS max FROM epics').get().max);
  }

  createTriage({ title, summary = '' }, actor = 'user') {
    const nextTitle = normalizeText(title);
    if (!nextTitle) throw httpError(400, 'Title is required');
    const id = this.nextId();
    const t = now();
    this.db.prepare(`INSERT INTO cards (id, title, summary, status, position, created_at, updated_at, epic_id) VALUES (?, ?, ?, 'triage', ?, ?, ?, NULL)`)
      .run(id, nextTitle, normalizeText(summary), this.maxPosition('triage') + 1, t, t);
    this.event(id, 'card_created', actor, { status: 'triage' });
    this.exportMarkdown('system');
    return this.card(id);
  }

  updateTriage(id, { title, summary }, actor = 'user') {
    const card = this.card(id);
    if (card.status !== 'triage') throw httpError(403, 'Users can edit only Triage cards');
    const nextTitle = title === undefined ? card.title : normalizeText(title);
    if (!nextTitle) throw httpError(400, 'Title is required');
    const nextSummary = summary === undefined ? card.summary : normalizeText(summary);
    this.db.prepare('UPDATE cards SET title = ?, summary = ?, updated_at = ? WHERE id = ?').run(nextTitle, nextSummary, now(), id);
    this.event(id, 'card_updated', actor, { fields: ['title', 'summary'] });
    this.exportMarkdown('system');
    return this.card(id);
  }

  createEpic({ title, summary = '', sort_index }, actor = 'agent') {
    const nextTitle = normalizeText(title);
    if (!nextTitle) throw httpError(400, 'Title is required');
    const nextSortIndex = sort_index === undefined ? this.maxEpicSortIndex() + 1 : normalizeSortIndex(sort_index);
    const id = this.nextEpicId();
    const t = now();
    this.db.prepare('INSERT INTO epics (id, title, summary, sort_index, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, nextTitle, normalizeText(summary), nextSortIndex, t, t);
    this.event(null, 'epic_created', actor, { epic_id: id });
    this.exportMarkdown('system');
    return this.epic(id);
  }

  updateEpic(id, patch, actor = 'agent') {
    const epic = this.epic(id);
    const nextTitle = patch.title === undefined ? epic.title : normalizeText(patch.title);
    if (!nextTitle) throw httpError(400, 'Title is required');
    const nextSummary = patch.summary === undefined ? epic.summary : normalizeText(patch.summary);
    const nextSortIndex = patch.sort_index === undefined ? epic.sort_index : normalizeSortIndex(patch.sort_index);
    this.db.prepare('UPDATE epics SET title = ?, summary = ?, sort_index = ?, updated_at = ? WHERE id = ?')
      .run(nextTitle, nextSummary, nextSortIndex, now(), id);
    this.event(null, 'epic_updated', actor, { epic_id: id, fields: Object.keys(patch) });
    this.exportMarkdown('system');
    return this.epic(id);
  }

  assignEpic(cardId, epicId, actor = 'agent') {
    const card = this.card(cardId);
    const nextEpicId = normalizeOptionalId(epicId);
    if (nextEpicId) this.epic(nextEpicId);
    this.db.prepare('UPDATE cards SET epic_id = ?, updated_at = ? WHERE id = ?').run(nextEpicId, now(), card.id);
    this.event(card.id, 'card_updated', actor, { fields: ['epic_id'], epic_id: nextEpicId });
    this.exportMarkdown('system');
    return this.card(card.id);
  }

  deleteEpic(id, actor = 'agent') {
    const epic = this.epic(id);
    const children = this.db.prepare('SELECT id FROM cards WHERE epic_id = ?').all(epic.id);
    const t = now();
    for (const row of children) {
      this.db.prepare('UPDATE cards SET epic_id = NULL, updated_at = ? WHERE id = ?').run(t, row.id);
      this.event(row.id, 'card_updated', actor, { fields: ['epic_id'], unassigned_epic: epic.id });
    }
    this.db.prepare('DELETE FROM epics WHERE id = ?').run(epic.id);
    const detached = children.map(row => row.id);
    this.event(null, 'epic_deleted', actor, { epic_id: epic.id, detached });
    this.exportMarkdown('system');
    return { id: epic.id, deleted: true, detached };
  }

  agentUpdate(id, patch, actor = 'agent') {
    const card = this.card(id);
    const next = {
      title: patch.title === undefined ? card.title : normalizeText(patch.title),
      summary: patch.summary === undefined ? card.summary : normalizeText(patch.summary),
      depends_on: patch.depends_on === undefined ? card.depends_on : this.validateCardIds(patch.depends_on, id),
      enables: patch.enables === undefined ? card.enables : this.validateCardIds(patch.enables, id),
      blocked_reason: patch.blocked_reason === undefined ? card.blocked_reason : normalizeText(patch.blocked_reason),
    };
    if (!next.title) throw httpError(400, 'Title is required');
    this.assertNoCycle(id, next.depends_on, next.enables);
    this.db.prepare('UPDATE cards SET title = ?, summary = ?, depends_on = ?, enables = ?, blocked_reason = ?, updated_at = ? WHERE id = ?')
      .run(next.title, next.summary, stringifyList(next.depends_on), stringifyList(next.enables), next.blocked_reason, now(), id);
    this.event(id, 'card_updated', actor, { fields: Object.keys(patch) });
    this.exportMarkdown('system');
    return this.card(id);
  }

  move(id, status, { blocked_reason } = {}, actor = 'agent') {
    assertStatus(status);
    const card = this.card(id);
    const reason = blocked_reason === undefined ? card.blocked_reason : normalizeText(blocked_reason);
    if (status === 'blocked' && !reason) throw httpError(400, 'Blocked cards require a blocked_reason');
    this.db.prepare('UPDATE cards SET status = ?, position = ?, blocked_reason = ?, updated_at = ? WHERE id = ?')
      .run(status, this.maxPosition(status) + 1, reason, now(), id);
    this.event(id, 'card_moved', actor, { from: card.status, to: status });
    this.exportMarkdown('system');
    return this.card(id);
  }

  deleteCard(id, actor = 'user') {
    const card = this.card(id);
    if (actor === 'user' && card.status !== 'triage') throw httpError(403, 'Users can delete only Triage cards');

    const linked = this.db.prepare(
      `SELECT id, depends_on, enables FROM cards WHERE id != ? AND (depends_on LIKE ? OR enables LIKE ?)`
    ).all(id, `%${id}%`, `%${id}%`);
    const t = now();
    for (const row of linked) {
      const depends_on = parseList(row.depends_on).filter(x => x !== id);
      const enables = parseList(row.enables).filter(x => x !== id);
      this.db.prepare('UPDATE cards SET depends_on = ?, enables = ?, updated_at = ? WHERE id = ?')
        .run(stringifyList(depends_on), stringifyList(enables), t, row.id);
      this.event(row.id, 'card_updated', actor, { fields: ['depends_on', 'enables'], unlinked: id });
    }

    this.db.prepare('DELETE FROM cards WHERE id = ?').run(id);
    this.event(id, 'card_deleted', actor, { status: card.status });
    this.exportMarkdown('system');
    return { id, deleted: true, status: card.status };
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
      const value = normalizeText(id);
      if (value === selfId) throw httpError(400, 'A card cannot link to itself');
      this.card(value);
      return value;
    });
  }

  // Reject links that would close a dependency cycle. depends_on and enables are
  // inverse edges of one directed graph (u -> v means "u depends on v"): C.depends_on
  // contributes C -> d, and C.enables contributes e -> C. A cycle means a circular
  // dependency that can never be satisfied. We use the proposed links for `id` and the
  // stored links for every other card, then check whether `id` can reach itself —
  // scoping the guard to the edited card so unrelated legacy data can't block an edit.
  assertNoCycle(id, dependsOn, enables) {
    const edges = new Map();
    const addEdge = (from, to) => {
      if (!edges.has(from)) edges.set(from, new Set());
      edges.get(from).add(to);
    };
    for (const card of this.cards()) {
      const deps = card.id === id ? dependsOn : card.depends_on;
      const unlocks = card.id === id ? enables : card.enables;
      for (const target of deps) addEdge(card.id, target);
      for (const target of unlocks) addEdge(target, card.id);
    }
    const seen = new Set();
    const stack = [...(edges.get(id) ?? [])];
    while (stack.length) {
      const node = stack.pop();
      if (node === id) throw httpError(400, 'Card links would create a dependency cycle');
      if (seen.has(node)) continue;
      seen.add(node);
      for (const next of edges.get(node) ?? []) stack.push(next);
    }
  }

  exportMarkdown(actor = 'system') {
    const cards = this.cards();
    const epics = this.epics();
    const byStatus = new Map(COLUMNS.map(c => [c.key, []]));
    for (const card of cards) byStatus.get(card.status)?.push(card);

    const lines = ['# Roadmap', '', '> Generated from `.pi/roadmap/roadmap.sqlite`. Do not edit directly.', '', '## Epics', ''];
    if (epics.length === 0) lines.push('_No epics._', '');
    else {
      for (const epic of epics) {
        lines.push(`- **${epic.id}** — ${epic.title}`);
        if (epic.summary) lines.push(`  - Summary: ${epic.summary}`);
        lines.push(`  - Progress: ${epic.done_count} / ${epic.total_count} (${epic.percent_complete}%)`);
        if (epic.card_ids.length) lines.push(`  - Cards: ${epic.card_ids.join(', ')}`);
        else lines.push('  - Cards: _No cards yet._');
      }
      lines.push('');
    }

    for (const col of COLUMNS) {
      lines.push(`## ${col.label}`, '');
      const statusCards = byStatus.get(col.key) ?? [];
      if (statusCards.length === 0) {
        lines.push('_No cards._', '');
        continue;
      }
      for (const card of statusCards) {
        lines.push(`- **${card.id}** — ${card.title}`);
        if (card.summary) lines.push(`  - Summary: ${card.summary}`);
        if (card.epic_id) lines.push(`  - Epic: ${card.epic_id}`);
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
