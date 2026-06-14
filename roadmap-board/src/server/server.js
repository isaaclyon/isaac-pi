import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRoadmap } from './model.js';
import { createActivityRing, mergeTimeline } from './activity.js';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const TIMELINE_MAX = 200;

export async function startServer({ projectRoot = process.cwd(), port = 4177 } = {}) {
  const store = openRoadmap(projectRoot);
  // Ephemeral, per-process live-activity buffer. Reset whenever this server (re)starts —
  // GET /api/timeline merges in durable milestone events so the feed survives that reset.
  const activity = createActivityRing({ cap: TIMELINE_MAX });
  const startedAt = new Date().toISOString();
  const app = express();
  app.use(express.json());

  app.get('/api/roadmap', (_req, res) => res.json(store.snapshot()));
  app.get('/api/cards/:id/events', (req, res, next) => { try { res.json(store.cardEvents(req.params.id)); } catch (e) { next(e); } });
  app.patch('/api/cards/:id/agent', (req, res, next) => { try { res.json(store.agentUpdate(req.params.id, req.body, 'agent')); } catch (e) { next(e); } });
  app.post('/api/epics', (req, res, next) => { try { res.json(store.createEpic(req.body, 'agent')); } catch (e) { next(e); } });
  app.post('/api/epics/reorder', (req, res, next) => { try { res.json(store.reorderEpics(req.body.ids, 'agent')); } catch (e) { next(e); } });
  app.patch('/api/epics/:id', (req, res, next) => { try { res.json(store.updateEpic(req.params.id, req.body, 'agent')); } catch (e) { next(e); } });
  app.delete('/api/epics/:id', (req, res, next) => { try { res.json(store.deleteEpic(req.params.id, 'agent')); } catch (e) { next(e); } });
  app.post('/api/cards/:id/epic', (req, res, next) => { try { res.json(store.assignEpic(req.params.id, req.body.epic_id ?? null, 'agent')); } catch (e) { next(e); } });
  app.post('/api/cards/:id/move', (req, res, next) => { try { res.json(store.move(req.params.id, req.body.status, { blocked_reason: req.body.blocked_reason }, 'agent')); } catch (e) { next(e); } });
  app.post('/api/cards/:id/claim', (req, res, next) => { try { res.json(store.claimCard(req.params.id, req.body.owner, { note: req.body.note, force: req.body.force }, 'agent')); } catch (e) { next(e); } });
  app.post('/api/cards/:id/release', (req, res, next) => { try { res.json(store.releaseCard(req.params.id, { owner: req.body.owner, force: req.body.force }, 'agent')); } catch (e) { next(e); } });

  // --- live activity timeline (ROAD-025) ---------------------------------------------
  // POST is the extension's fire-and-forget reporting endpoint: it records one shaped
  // lifecycle event into the in-RAM ring and attributes it (server-side) to the card the
  // reporting session currently claims, so the extension stays unaware of card context.
  app.post('/api/activity', (req, res, next) => {
    try {
      const { session, kind, title, status } = req.body ?? {};
      if (!kind || typeof kind !== 'string') { res.status(400).json({ error: 'kind is required' }); return; }
      const held = session ? store.cardClaimedBy(String(session)) : null;
      const record = activity.append({
        session: session ? String(session) : null,
        kind,
        title: title === undefined || title === null ? '' : String(title),
        status: status === undefined ? null : status,
        card_id: held ? held.id : null,
        ts: new Date().toISOString(),
      });
      res.json(record);
    } catch (e) { next(e); }
  });

  // GET merges the ephemeral ring (live activity) with durable milestone events from
  // SQLite (claims/moves) into one newest-first feed. `?card=` scopes both halves to a
  // card (the modal view); `?session=` scopes to a session's live activity only, since
  // milestone events aren't session-attributed. `started_at` lets a client tell when the
  // live half was last reset by a respawn.
  app.get('/api/timeline', (req, res, next) => {
    try {
      const limit = Math.min(Math.max(1, Number(req.query.limit) || 50), TIMELINE_MAX);
      const session = req.query.session ? String(req.query.session) : undefined;
      const card = req.query.card ? String(req.query.card) : undefined;
      const live = activity.list({ limit, session, card });
      let milestones = session ? [] : store.timelineEvents(limit);
      if (card) milestones = milestones.filter(m => m.card_id === card);
      const items = mergeTimeline(live, milestones, { limit, cardTitles: store.cardTitleMap() });
      res.json({ items, started_at: startedAt });
    } catch (e) { next(e); }
  });

  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message }));

  const dist = join(packageRoot, 'dist');
  if (existsSync(dist)) app.use(express.static(dist));

  const server = createServer(app);
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(`Roadmap Board running at http://127.0.0.1:${port}`);
  return { app, server, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({
    projectRoot: process.env.ROADMAP_PROJECT_ROOT || process.cwd(),
    port: Number(process.env.PORT || 4177),
  }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}
