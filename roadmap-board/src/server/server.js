import express from 'express';
import { createServer } from 'node:http';
import { openRoadmap } from './model.js';

export async function startServer({ projectRoot = process.cwd(), port = 4177 } = {}) {
  const store = openRoadmap(projectRoot);
  const app = express();
  app.use(express.json());

  app.get('/api/roadmap', (_req, res) => res.json(store.snapshot()));
  app.post('/api/cards', (req, res, next) => { try { res.json(store.createTriage(req.body, 'user')); } catch (e) { next(e); } });
  app.patch('/api/cards/:id/triage', (req, res, next) => { try { res.json(store.updateTriage(req.params.id, req.body, 'user')); } catch (e) { next(e); } });
  app.patch('/api/cards/:id/agent', (req, res, next) => { try { res.json(store.agentUpdate(req.params.id, req.body, 'agent')); } catch (e) { next(e); } });
  app.post('/api/cards/:id/move', (req, res, next) => { try { res.json(store.move(req.params.id, req.body.status, { blocked_reason: req.body.blocked_reason }, 'agent')); } catch (e) { next(e); } });
  app.post('/api/triage/reorder', (req, res, next) => { try { res.json(store.reorderTriage(req.body.ids, 'user')); } catch (e) { next(e); } });

  app.use((error, _req, res, _next) => res.status(error.status ?? 500).json({ error: error.message }));

  const server = createServer(app);
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  console.log(`Roadmap Board running at http://127.0.0.1:${port}`);
  return { app, server, store };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startServer({ port: Number(process.env.PORT || 4177) }).catch(error => {
    console.error(error);
    process.exit(1);
  });
}
