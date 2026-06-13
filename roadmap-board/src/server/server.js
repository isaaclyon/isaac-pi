import express from 'express';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRoadmap } from './model.js';

const packageRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

export async function startServer({ projectRoot = process.cwd(), port = 4177 } = {}) {
  const store = openRoadmap(projectRoot);
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
