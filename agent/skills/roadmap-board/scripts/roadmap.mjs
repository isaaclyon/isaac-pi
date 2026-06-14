#!/usr/bin/env node
// Portable roadmap-board helper.
//
// Self-contained resolver + thin wrapper around roadmap-board/src/server/cli.js.
// - Finds the target board (project root) and the CLI without any install step.
// - Adds token-light reads (`get`, filtered `list`, `epics`) the CLI lacks.
// - Passes every write verb straight through to the CLI (single source of truth).
//
// Resolution order (both overridable by env so it works from any project/worktree):
//   project root : $ROADMAP_PROJECT_ROOT  ->  parent of `git rev-parse --git-common-dir`
//                                              (the MAIN checkout, so worktrees share its board)
//                                          ->  walk up from cwd for .pi/roadmap/roadmap.sqlite
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
  'add', 'update', 'user-update', 'attach-doc', 'detach-doc', 'move', 'claim', 'release', 'delete', 'reorder', 'events', 'export',
  'epic-add', 'epic-update', 'epic-delete', 'epic-archive', 'epic-unarchive', 'reorder-epics',
  'assign-epic', 'clear-epic',
  // The live activity feed — the one read served over HTTP from the running server's RAM, not
  // SQLite. The CLI handles the connect-or-degrade itself; we just forward (cwd = projectRoot so
  // it can find .server.json). Returns an annotated empty result when no server is up.
  'timeline',
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

// A linked git worktree's `.git` points at the primary checkout, so `git rev-parse
// --git-common-dir` (then its parent) is the main repo that owns the single gitignored
// board — the same trick also targets the repo root from any subdirectory. Returns null
// when cwd isn't in a git repo (or git is unavailable), so the walk-up fallback still runs.
function gitCommonRoot(cwd) {
  try {
    const out = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out ? dirname(resolve(cwd, out)) : null;
  } catch {
    return null;
  }
}

function hasBoard(root) {
  return !!root && existsSync(join(root, '.pi', 'roadmap', 'roadmap.sqlite'));
}

// The board lives in the MAIN checkout. Resolve there first (env override, then the git
// common dir) so a worktree never reads or writes a stray per-worktree board; fall back to
// walking up only when we're not inside a git repo at all.
function findProjectRoot() {
  if (process.env.ROADMAP_PROJECT_ROOT) return resolve(process.env.ROADMAP_PROJECT_ROOT);
  const common = gitCommonRoot(process.cwd());
  if (common) return common;
  return walkUp(process.cwd(), dir =>
    hasBoard(dir) ? dir : null);
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
      'epics [--archived|--all]': 'Slim epic list with derived progress + is_complete/archived. Active-only by default; --archived for archived, --all for both.',
    },
    writes: {
      'add <title> [summary]': 'Create a Triage card (user actor).',
      'update <id> <json>': 'Patch title|summary|depends_on|enables|blocked_reason|documents.',
      'attach-doc <id> <title> <href> [kind] [note]': 'Attach a supporting document reference to a card.',
      'detach-doc <id> <href>': 'Remove document references from a card by href.',
      'move <id> <status> [reason]': 'Move card; status=blocked requires a reason.',
      'claim <id> [owner] [note]': 'Claim a card (owner defaults to $ROADMAP_SESSION_ID); --force to steal.',
      'release <id> [owner]': 'Release a card\'s claim; --force to override the owner check.',
      'assign-epic <cardId> <epicId>': 'Attach card to epic.',
      'clear-epic <cardId>': 'Detach card from its epic.',
      'epic-add <title> [summary]': 'Create an epic.',
      'epic-update <id> <json>': 'Patch epic title|summary|sort_index.',
      'epic-delete <id>': 'Delete epic; detaches its cards.',
      'epic-archive <id>': 'Archive epic (reversible; keeps cards & history).',
      'epic-unarchive <id>': 'Restore an archived epic.',
      'reorder-epics <id,id,...>': 'Reorder all Epics (sets sort_index).',
      'delete <id>': 'Delete a card (agent: any column).',
      'reorder <id,id,...>': 'Reorder all Triage cards.',
    },
    misc: {
      'events <id>': 'Card event history as JSON.',
      'timeline [--limit N] [--session S] [--card C]': 'Live activity feed (reads the running server over HTTP; empty when no server is up — the feed is in-memory).',
      'export': 'Regenerate ROADMAP.md (writes auto-export already).',
      'init': 'Create local DB, prompt config, and ROADMAP.md.',
      'paths': 'Print resolved board paths.',
    },
    statuses: STATUSES,
    resolution: {
      project_root: process.env.ROADMAP_PROJECT_ROOT
        || '(main checkout via `git rev-parse --git-common-dir`, so worktrees share its board; '
          + 'else walk up from cwd for .pi/roadmap/roadmap.sqlite)',
      cli: process.env.ROADMAP_CLI || '(walk up from cwd, then bundled in-repo copy)',
    },
  });
}

function parseFlags(args) {
  const flags = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--status') flags.status = args[++i];
    else if (args[i] === '--epic') flags.epic = args[++i];
    else if (args[i] === '--archived') flags.archived = true;
    else if (args[i] === '--all') flags.all = true;
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
  // `init` resolves to the main checkout too, so it creates the board there (not in a worktree).
  let projectRoot = findProjectRoot();
  if (BOOTSTRAP.has(cmd)) {
    if (!projectRoot) projectRoot = process.cwd();
    process.stdout.write(runCli(cliPath, projectRoot, [cmd, ...args]));
    return;
  }
  if (!hasBoard(projectRoot)) {
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
    // Default view is active-only; --archived shows just archived, --all shows both. is_complete
    // surfaces the derived "Done" state so callers can spot epics ready to archive.
    const { archived, all } = parseFlags(args);
    let epics = snapshot(cliPath, projectRoot).epics;
    if (!all) epics = epics.filter(e => (archived ? !!e.archived_at : !e.archived_at));
    return print(epics.map(e => ({
      id: e.id, title: e.title, sort_index: e.sort_index,
      done_count: e.done_count, total_count: e.total_count, percent_complete: e.percent_complete,
      is_complete: e.is_complete, archived: !!e.archived_at,
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
