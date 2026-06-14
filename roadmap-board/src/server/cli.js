#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { openRoadmap, paths } from './model.js';
import { startServer } from './server.js';

function parseJson(value, fallback) {
  if (value === undefined) return fallback;
  return JSON.parse(value);
}

function flagValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

// The live activity timeline (ROAD-025) is the one read that does NOT go through SQLite.
// Its live half lives in the running server's RAM, which a short-lived CLI process (with
// its own DB connection) cannot see — so it must ask the live server over HTTP, and
// degrade to an annotated empty result when none is running.
function readServerPort(cwd) {
  try {
    const state = JSON.parse(readFileSync(join(paths(cwd).dir, '.server.json'), 'utf8'));
    return typeof state.port === 'number' ? state.port : null;
  } catch {
    return null;
  }
}

function httpGetJson(port, path, timeoutMs = 2000) {
  return new Promise(resolveJson => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: timeoutMs }, res => {
      if (res.statusCode !== 200) { res.resume(); resolveJson(null); return; }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => (body += chunk));
      res.on('end', () => { try { resolveJson(JSON.parse(body)); } catch { resolveJson(null); } });
    });
    req.on('timeout', () => { req.destroy(); resolveJson(null); });
    req.on('error', () => resolveJson(null));
    req.end();
  });
}

async function timelineCommand(args) {
  const empty = {
    items: [],
    started_at: null,
    note: 'No roadmap server is running. The live activity feed lives in the server process; start one with `serve` (or open the board) to populate it.',
  };
  const port = readServerPort(process.cwd());
  if (!port) { console.log(JSON.stringify(empty, null, 2)); return; }
  const params = new URLSearchParams();
  const limit = flagValue(args, '--limit');
  const session = flagValue(args, '--session');
  const card = flagValue(args, '--card');
  if (limit) params.set('limit', limit);
  if (session) params.set('session', session);
  if (card) params.set('card', card);
  const qs = params.toString();
  const result = await httpGetJson(port, qs ? `/api/timeline?${qs}` : '/api/timeline');
  console.log(JSON.stringify(result ?? empty, null, 2));
}

function usage() {
  console.log(`roadmap-board <command>

Commands:
  init                              Create local DB, prompt config, and ROADMAP.md
  serve [--port 4177]               Start local React/API server
  list                              Print all cards as JSON
  ready                             Print cards whose dependencies are all completed
  blocked-deps                      Print cards waiting on an incomplete dependency
  events <id>                       Print a card's event history as JSON
  timeline [--limit N] [--session S] [--card C]
                                    Live activity feed (reads the running server over HTTP;
                                    empty when no server is up — the feed is in-memory)
  add <title> [summary]             Add a user Triage card
  agent-add <title> [summary]       Add an agent-created Triage card
  epic-add <title> [summary]        Add an Epic
  epic-update <id> <json>           Update Epic fields: title, summary, sort_index
  epic-delete <id>                  Delete an Epic; detaches its cards
  epic-archive <id>                 Archive an Epic (reversible; keeps cards & history)
  epic-unarchive <id>               Restore an archived Epic
  reorder-epics <id,id,...>         Reorder all Epics (sets sort_index)
  update <id> <json>                Agent update fields: title, summary, depends_on, enables, blocked_reason, documents
  user-update <id> <json>           User update Triage title/summary only
  attach-doc <id> <title> <href> [kind] [note]
                                    Attach a supporting document reference to a card
  detach-doc <id> <href>            Remove document references from a card by href
  assign-epic <cardId> <epicId>     Assign card to Epic
  clear-epic <cardId>               Remove card from Epic
  move <id> <status> [reason]       Agent move card; blocked requires reason
  claim <id> [owner] [note]         Claim a card (owner defaults to $ROADMAP_SESSION_ID); --force to steal
  release <id> [owner]              Release a card's claim; --force to override owner check
  delete <id>                       Delete a card (agent: any column)
  reorder <id,id,...>               Reorder all Triage cards
  export                            Regenerate ROADMAP.md
  paths                             Print resolved paths
`);
}

async function main() {
  const [cmd, ...args] = process.argv.slice(2);
  if (!cmd || cmd === 'help' || cmd === '--help') { usage(); return; }
  if (cmd === 'serve') {
    const portFlag = args.indexOf('--port');
    const port = portFlag >= 0 ? Number(args[portFlag + 1]) : Number(process.env.PORT || 4177);
    await startServer({ projectRoot: process.cwd(), port });
    return;
  }
  if (cmd === 'paths') { console.log(JSON.stringify(paths(process.cwd()), null, 2)); return; }
  if (cmd === 'timeline') { await timelineCommand(args); return; }

  const store = openRoadmap(process.cwd());
  try {
    let result;
    if (cmd === 'init') result = store.init();
    else if (cmd === 'list') result = store.snapshot();
    else if (cmd === 'ready') result = store.readyCards();
    else if (cmd === 'blocked-deps') result = store.dependencyBlockedCards();
    else if (cmd === 'events') result = store.cardEvents(args[0]);
    else if (cmd === 'add') result = store.createTriage({ title: args[0], summary: args[1] ?? '' }, 'user');
    else if (cmd === 'agent-add') result = store.createTriage({ title: args[0], summary: args[1] ?? '' }, 'agent');
    else if (cmd === 'epic-add') result = store.createEpic({ title: args[0], summary: args[1] ?? '' }, 'agent');
    else if (cmd === 'epic-update') result = store.updateEpic(args[0], parseJson(args[1], {}), 'agent');
    else if (cmd === 'epic-delete') result = store.deleteEpic(args[0], 'agent');
    else if (cmd === 'epic-archive') result = store.archiveEpic(args[0], 'agent');
    else if (cmd === 'epic-unarchive') result = store.unarchiveEpic(args[0], 'agent');
    else if (cmd === 'reorder-epics') result = store.reorderEpics((args[0] ?? '').split(',').filter(Boolean), 'agent');
    else if (cmd === 'user-update') result = store.updateTriage(args[0], parseJson(args[1], {}), 'user');
    else if (cmd === 'update') result = store.agentUpdate(args[0], parseJson(args[1], {}), 'agent');
    else if (cmd === 'attach-doc') result = store.attachDocument(args[0], { title: args[1], href: args[2], kind: args[3], note: args[4] }, 'agent');
    else if (cmd === 'detach-doc') result = store.detachDocument(args[0], args[1], 'agent');
    else if (cmd === 'assign-epic') result = store.assignEpic(args[0], args[1], 'agent');
    else if (cmd === 'clear-epic') result = store.assignEpic(args[0], null, 'agent');
    else if (cmd === 'move') result = store.move(args[0], args[1], { blocked_reason: args[2] }, 'agent');
    else if (cmd === 'claim') {
      const force = args.includes('--force');
      const [id, owner, note] = args.filter(a => a !== '--force');
      result = store.claimCard(id, owner ?? process.env.ROADMAP_SESSION_ID, { note, force }, 'agent');
    }
    else if (cmd === 'release') {
      const force = args.includes('--force');
      const [id, owner] = args.filter(a => a !== '--force');
      result = store.releaseCard(id, { owner, force }, 'agent');
    }
    else if (cmd === 'delete') result = store.deleteCard(args[0], 'agent');
    else if (cmd === 'reorder') result = store.reorderTriage((args[0] ?? '').split(',').filter(Boolean), 'user');
    else if (cmd === 'export') result = { markdown: store.exportMarkdown('system') };
    else throw new Error(`Unknown command: ${cmd}`);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    store.close();
  }
}

main().catch(error => {
  console.error(error.message);
  process.exit(1);
});
