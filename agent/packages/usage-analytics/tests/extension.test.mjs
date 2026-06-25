import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUsageAnalyticsDb } from '../src/db.mjs';
import usageTracker from '../extensions/usage-tracker.ts';

function createMockPi(tools, overrides = {}) {
  const handlers = new Map();
  return {
    on(event, handler) {
      handlers.set(event, handler);
    },
    getAllTools() {
      return tools;
    },
    handlers,
    ...overrides,
  };
}

test('usage tracker defers tool lookup until runtime is ready', async () => {
  let runtimeReady = false;
  const pi = createMockPi([], {
    getAllTools() {
      if (!runtimeReady) {
        throw new Error('runtime not initialized');
      }
      return [];
    },
  });

  assert.doesNotThrow(() => {
    usageTracker(pi);
  });

  runtimeReady = true;
  await assert.doesNotReject(async () => {
    await pi.handlers.get('session_start')({}, {
      cwd: process.cwd(),
      sessionManager: { getSessionFile: () => '/tmp/session.jsonl' },
    });
  });
});

test('usage tracker records raw input and tool provenance', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-analytics-ext-'));
  const dbPath = join(tempDir, 'usage.sqlite');
  process.env.PI_USAGE_ANALYTICS_DB_PATH = dbPath;

  const pi = createMockPi([
    {
      name: 'demo_extension_tool',
      description: '',
      parameters: {},
      promptGuidelines: [],
      sourceInfo: {
        path: 'extensions/demo.ts',
        source: 'demo-extension',
        scope: 'temporary',
        origin: 'top-level',
      },
    },
  ]);

  usageTracker(pi);

  const ctx = {
    cwd: tempDir,
    sessionManager: { getSessionFile: () => '/tmp/session.jsonl' },
  };

  await pi.handlers.get('session_start')({}, ctx);
  await pi.handlers.get('input')({ text: '/skill:usage-analytics now', source: 'interactive' }, ctx);
  await pi.handlers.get('tool_execution_start')({ toolCallId: 'tool-1', toolName: 'demo_extension_tool', args: {} }, ctx);
  await pi.handlers.get('tool_execution_end')({ toolCallId: 'tool-1', toolName: 'demo_extension_tool', result: {}, isError: false }, ctx);
  await pi.handlers.get('session_shutdown')({}, ctx);

  const db = openUsageAnalyticsDb({ dbPath, readOnly: true });
  try {
    const skills = db.prepare('SELECT skill_name, raw_input FROM skill_invocations').all().map((row) => ({ ...row }));
    const tools = db.prepare('SELECT tool_name, tool_source FROM tool_executions').all().map((row) => ({ ...row }));

    assert.deepEqual(skills, [{ skill_name: 'usage-analytics', raw_input: '/skill:usage-analytics now' }]);
    assert.deepEqual(tools, [{ tool_name: 'demo_extension_tool', tool_source: 'extension' }]);
  } finally {
    db.close();
    delete process.env.PI_USAGE_ANALYTICS_DB_PATH;
  }
});
