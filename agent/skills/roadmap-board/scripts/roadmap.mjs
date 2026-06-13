#!/usr/bin/env node
// Portable roadmap-board helper.
//
// Self-contained resolver + thin wrapper around roadmap-board/src/server/cli.js.
// - Finds the target board (project root) and the CLI without any install step.
// - Adds token-light reads (`get`, filtered `list`, `epics`) the CLI lacks.
// - Passes every write verb straight through to the CLI (single source of truth).
//
// Resolution order (both overridable by env so it works from any project/worktree):
//   project root : $ROADMAP_PROJECT_ROOT  ->  walk up from cwd for .pi/roadmap/roadmap.sqlite
//   cli.js       : $ROADMAP_CLI           ->  walk up from cwd for roadmap-board/src/server/cli.js
//                                          ->  bundled checkout relative to this skill

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_REL = join('roadmap-board', 'src', 'server', 'cli.js');

const STATUSES = ['triage', 'backlog', 'up_next', 'in_progress', 'blocked', 'review', 'completed'];

// Verbs that mutate or read an existing board (require a resolved project root + an initialized DB).
const PASSTHROUGH = new Set([
  'add', 'update', 'user-update', 'move', 'delete', 'reorder', 'events', 'export',
  'epic-add', 'epic-update', 'epic-delete', 'assign-epic', 'clear-epic',
]);
// Verbs that work without an existing board.
const BOOTSTRAP = new Set(['init', 'paths']);

function fail(msg) { console.error(String(msg)); process.exit(1); }

function walkUp(startDir, test) {
  let dir = resolve(startDir);
  for (;;) {
    const hit = test(dir);
    if (hit) return hit;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function findProjectRoot() {
  if (process.env.ROADMAP_PROJECT_ROOT) return resolve(process.env.ROADMAP_PROJECT_ROOT);
  return walkUp(process.cwd(), dir =>
    existsSync(join(dir, '.pi', 'roadmap', 'roadmap.sqlite')) ? dir : null);
}

function findCli() {
  if (process.env.ROADMAP_CLI) return resolve(process.env.ROADMAP_CLI);
  const fromCwd = walkUp(process.cwd(), dir => {
    const c = join(dir, CLI_REL);
    return existsSync(c) ? c : null;
  });
  if (fromCwd) return fromCwd;
  // Bundled fallback: this skill lives at <repo>/agent/skills/roadmap-board/scripts/,
  // so the in-repo CLI is four levels up.
  const bundled = resolve(HERE, '..', '..', '..', '..', CLI_REL);
  return existsSync(bundled) ? bundled : null;
}

function runCli(cliPath, projectRoot, args) {
  try {
    return execFileSync('node', ['--no-warnings', cliPath, ...args], {
      cwd: projectRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const stderr = (err.stderr || '').toString().trim();
    const stdout = (err.stdout || '').toString().trim();
    fail(stderr || stdout || err.message);
  }
}

function snapshot(cliPath, projectRoot) {
  return JSON.parse(runCli(cliPath, projectRoot, ['list']));
}

function print(value) { process.stdout.write(JSON.stringify(value, null, 2) + '\n'); }

function usage() {
  print({
    usage: 'roadmap <command> [...args]',
    reads: {
      'get <id>': 'One card (full fields) plus its event history.',
      'list [--status S] [--epic E|none]': 'Slim card list (id,title,status,epic_id), optionally filtered.',
      'ready [--epic E|none]': 'Slim list of cards whose dependencies are all completed (and that aren\'t completed).',
      'blocked-deps [--epic E|none]': 'Slim list of cards waiting on an incomplete dependency (derived; independent of the blocked status).',
      'epics': 'Slim epic list with derived progress.',
    },
    writes: {
      'add <title> [summary]': 'Create a Triage card (user actor).',
      'update <id> <json>': 'Patch title|summary|depends_on|enables|blocked_reason.',
      'move <id> <status> [reason]': 'Move card; status=blocked requires a reason.',
      'assign-epic <cardId> <epicId>': 'Attach card to epic.',
      'clear-epic <cardId>': 'Detach card from its epic.',
      'epic-add <title> [summary]': 'Create an epic.',
      'epic-update <id> <json>': 'Patch epic title|summary|sort_index.',
      'epic-delete <id>': 'Delete epic; detaches its cards.',
      'delete <id>': 'Delete a card (agent: any column).',
      'reorder <id,id,...>': 'Reorder all Triage cards.',
    },
    misc: {
      'events <id>': 'Card event history as JSON.',
      'export': 'Regenerate ROADMAP.md (writes auto-export already).',
      'init': 'Create local DB, prompt config, and ROADMAP.md.',
      'paths': 'Print resolved board paths.',
    },
    statuses: STATUSES,
    resolution: {
      project_root: process.env.ROADMAP_PROJECT_ROOT || '(walk up from cwd for .pi/roadmap/roadmap.sqlite)',
      cli: process.env.ROADMAP_CLI || '(walk up from cwd, then bundled in-repo copy)',
    },
  });
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status') flags.status = args[++i];
    else if (args[i] === '--epic') flags.epic = args[++i];
  }
  return flags;
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') return usage();

  const cliPath = findCli();
  if (!cliPath) {
    fail('Could not locate roadmap-board CLI. Set ROADMAP_CLI to .../roadmap-board/src/server/cli.js, '
      + 'or run from inside a project that contains a roadmap-board checkout.');
  }

  // Bootstrap verbs default to cwd; everything else needs an initialized board.
  let projectRoot = findProjectRoot();
  if (BOOTSTRAP.has(cmd)) {
    if (!projectRoot) projectRoot = process.cwd();
    process.stdout.write(runCli(cliPath, projectRoot, [cmd, ...args]));
    return;
  }
  if (!projectRoot) {
    fail('No roadmap board found (.pi/roadmap/roadmap.sqlite). Run `roadmap init` in the project root, '
      + 'or set ROADMAP_PROJECT_ROOT to the project that owns the board.');
  }

  if (cmd === 'get') {
    const id = args[0];
    if (!id) fail('Usage: roadmap get <id>');
    const snap = snapshot(cliPath, projectRoot);
    const card = snap.cards.find(c => c.id === id);
    if (!card) fail(`Unknown card: ${id}`);
    const events = JSON.parse(runCli(cliPath, projectRoot, ['events', id]));
    return print({ card, events });
  }

  if (cmd === 'list') {
    const { status, epic } = parseFlags(args);
    if (status && !STATUSES.includes(status)) fail(`Invalid status: ${status}. Valid: ${STATUSES.join(', ')}`);
    let cards = snapshot(cliPath, projectRoot).cards;
    if (status) cards = cards.filter(c => c.status === status);
    if (epic === 'none') cards = cards.filter(c => !c.epic_id);
    else if (epic) cards = cards.filter(c => c.epic_id === epic);
    return print({
      count: cards.length,
      cards: cards.map(c => ({ id: c.id, title: c.title, status: c.status, epic_id: c.epic_id })),
    });
  }

  if (cmd === 'ready') {
    const { epic } = parseFlags(args);
    let cards = snapshot(cliPath, projectRoot).cards.filter(c => c.ready);
    if (epic === 'none') cards = cards.filter(c => !c.epic_id);
    else if (epic) cards = cards.filter(c => c.epic_id === epic);
    return print({
      count: cards.length,
      cards: cards.map(c => ({ id: c.id, title: c.title, status: c.status, epic_id: c.epic_id })),
    });
  }

  if (cmd === 'blocked-deps') {
    const { epic } = parseFlags(args);
    let cards = snapshot(cliPath, projectRoot).cards.filter(c => c.dependency_blocked);
    if (epic === 'none') cards = cards.filter(c => !c.epic_id);
    else if (epic) cards = cards.filter(c => c.epic_id === epic);
    return print({
      count: cards.length,
      cards: cards.map(c => ({ id: c.id, title: c.title, status: c.status, epic_id: c.epic_id })),
    });
  }

  if (cmd === 'epics') {
    const epics = snapshot(cliPath, projectRoot).epics;
    return print(epics.map(e => ({
      id: e.id, title: e.title, sort_index: e.sort_index,
      done_count: e.done_count, total_count: e.total_count, percent_complete: e.percent_complete,
      card_ids: e.card_ids,
    })));
  }

  if (PASSTHROUGH.has(cmd)) {
    process.stdout.write(runCli(cliPath, projectRoot, [cmd, ...args]));
    return;
  }

  fail(`Unknown command: ${cmd}. Run \`roadmap help\` for usage.`);
}

main();
