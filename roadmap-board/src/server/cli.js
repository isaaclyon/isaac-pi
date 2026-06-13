#!/usr/bin/env node
import { openRoadmap, paths } from './model.js';
import { startServer } from './server.js';

function parseJson(value, fallback) {
  if (value === undefined) return fallback;
  return JSON.parse(value);
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
  add <title> [summary]             Add a user Triage card
  epic-add <title> [summary]        Add an Epic
  epic-update <id> <json>           Update Epic fields: title, summary, sort_index
  epic-delete <id>                  Delete an Epic; detaches its cards
  update <id> <json>                Agent update fields: title, summary, depends_on, enables, blocked_reason
  user-update <id> <json>           User update Triage title/summary only
  assign-epic <cardId> <epicId>     Assign card to Epic
  clear-epic <cardId>               Remove card from Epic
  move <id> <status> [reason]       Agent move card; blocked requires reason
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

  const store = openRoadmap(process.cwd());
  try {
    let result;
    if (cmd === 'init') result = store.init();
    else if (cmd === 'list') result = store.snapshot();
    else if (cmd === 'ready') result = store.readyCards();
    else if (cmd === 'blocked-deps') result = store.dependencyBlockedCards();
    else if (cmd === 'events') result = store.cardEvents(args[0]);
    else if (cmd === 'add') result = store.createTriage({ title: args[0], summary: args[1] ?? '' }, 'user');
    else if (cmd === 'epic-add') result = store.createEpic({ title: args[0], summary: args[1] ?? '' }, 'agent');
    else if (cmd === 'epic-update') result = store.updateEpic(args[0], parseJson(args[1], {}), 'agent');
    else if (cmd === 'epic-delete') result = store.deleteEpic(args[0], 'agent');
    else if (cmd === 'user-update') result = store.updateTriage(args[0], parseJson(args[1], {}), 'user');
    else if (cmd === 'update') result = store.agentUpdate(args[0], parseJson(args[1], {}), 'agent');
    else if (cmd === 'assign-epic') result = store.assignEpic(args[0], args[1], 'agent');
    else if (cmd === 'clear-epic') result = store.assignEpic(args[0], null, 'agent');
    else if (cmd === 'move') result = store.move(args[0], args[1], { blocked_reason: args[2] }, 'agent');
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
