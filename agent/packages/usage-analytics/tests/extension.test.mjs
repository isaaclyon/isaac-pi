import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, realpathSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUsageAnalyticsDb, recordToolExecution } from '../src/db.mjs';
import usageTracker from '../extensions/usage-tracker.ts';

function corruptDatabasePage(dbPath, pageNumber, pageSize) {
  const fd = openSync(dbPath, 'r+');
  try {
    writeSync(fd, Buffer.from([0xff, 0xff, 0xff, 0xff]), 0, 4, (pageNumber - 1) * pageSize);
  } finally {
    closeSync(fd);
  }
}

function createMockPi(tools, overrides = {}) {
  const handlers = new Map();
  return {
    on(event, handler) {
      handlers.set(event, handler);
    },
    getAllTools() {
      return tools;
    },
    getCommands() {
      return [];
    },
    handlers,
    ...overrides,
  };
}

function createReadTool() {
  return {
    name: 'read',
    description: '',
    parameters: {},
    promptGuidelines: [],
    sourceInfo: {
      path: '<builtin:read>',
      source: 'builtin',
      scope: 'temporary',
      origin: 'top-level',
    },
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

test('usage tracker ignores events outside the Pi repository', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-analytics-outside-'));
  const dbPath = join(tempDir, 'usage.sqlite');
  process.env.PI_USAGE_ANALYTICS_DB_PATH = dbPath;

  const pi = createMockPi([]);
  usageTracker(pi);
  const ctx = {
    cwd: tempDir,
    sessionManager: { getSessionFile: () => '/tmp/session.jsonl' },
  };

  await pi.handlers.get('input')({ text: '/skill:usage-analytics now', source: 'interactive' }, ctx);
  await pi.handlers.get('tool_execution_start')({ toolCallId: 'tool-1', toolName: 'demo_tool', args: {} }, ctx);
  await pi.handlers.get('tool_execution_end')({ toolCallId: 'tool-1', toolName: 'demo_tool', result: {}, isError: false }, ctx);
  await pi.handlers.get('session_shutdown')({}, ctx);

  assert.equal(existsSync(dbPath), false);
  delete process.env.PI_USAGE_ANALYTICS_DB_PATH;
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
    cwd: process.cwd(),
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
    const skillLoads = db.prepare('SELECT skill_name, load_source, raw_input FROM skill_loads').all().map((row) => ({ ...row }));
    const tools = db.prepare('SELECT tool_name, tool_source FROM tool_executions').all().map((row) => ({ ...row }));

    assert.deepEqual(skills, [{ skill_name: 'usage-analytics', raw_input: '/skill:usage-analytics now' }]);
    assert.deepEqual(skillLoads, [{ skill_name: 'usage-analytics', load_source: 'explicit_command', raw_input: '/skill:usage-analytics now' }]);
    assert.deepEqual(tools, [{ tool_name: 'demo_extension_tool', tool_source: 'extension' }]);
  } finally {
    db.close();
    delete process.env.PI_USAGE_ANALYTICS_DB_PATH;
  }
});

test('usage tracker records successful reads of registered skill files', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-analytics-skill-load-'));
  const dbPath = join(tempDir, 'usage.sqlite');
  const skillDir = join(tempDir, 'skills', 'demo-skill');
  const skillPath = join(skillDir, 'SKILL.md');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(skillPath, '---\nname: demo-skill\ndescription: demo\n---\n# Demo\n');
  const realSkillPath = realpathSync.native(skillPath);
  process.env.PI_USAGE_ANALYTICS_DB_PATH = dbPath;

  const pi = createMockPi([createReadTool()], {
    getCommands() {
      return [{
        name: 'skill:demo-skill',
        source: 'skill',
        sourceInfo: { path: skillPath, source: 'test', scope: 'user', origin: 'top-level' },
      }];
    },
  });

  usageTracker(pi);

  const ctx = {
    cwd: process.cwd(),
    sessionManager: { getSessionFile: () => '/tmp/session.jsonl' },
  };

  await pi.handlers.get('session_start')({}, ctx);
  await pi.handlers.get('tool_execution_start')({ toolCallId: 'tool-1', toolName: 'read', args: { path: `@${skillPath}` } }, ctx);
  await pi.handlers.get('tool_execution_end')({ toolCallId: 'tool-1', toolName: 'read', result: {}, isError: false }, ctx);
  await pi.handlers.get('session_shutdown')({}, ctx);

  const db = openUsageAnalyticsDb({ dbPath, readOnly: true });
  try {
    const rows = db.prepare('SELECT skill_name, skill_path, load_source, tool_call_id FROM skill_loads').all().map((row) => ({ ...row }));
    assert.deepEqual(rows, [{
      skill_name: 'demo-skill',
      skill_path: realSkillPath,
      load_source: 'skill_file_read',
      tool_call_id: 'tool-1',
    }]);
  } finally {
    db.close();
    delete process.env.PI_USAGE_ANALYTICS_DB_PATH;
  }
});

test('usage tracker ignores failed or unregistered skill file reads', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-analytics-skill-load-ignore-'));
  const dbPath = join(tempDir, 'usage.sqlite');
  const skillDir = join(tempDir, 'skills', 'demo-skill');
  const skillPath = join(skillDir, 'SKILL.md');
  const unregisteredPath = join(tempDir, 'other', 'SKILL.md');
  mkdirSync(skillDir, { recursive: true });
  mkdirSync(join(tempDir, 'other'), { recursive: true });
  writeFileSync(skillPath, '---\nname: demo-skill\ndescription: demo\n---\n# Demo\n');
  writeFileSync(unregisteredPath, '---\nname: other\ndescription: other\n---\n# Other\n');
  process.env.PI_USAGE_ANALYTICS_DB_PATH = dbPath;

  const pi = createMockPi([createReadTool()], {
    getCommands() {
      return [{
        name: 'skill:demo-skill',
        source: 'skill',
        sourceInfo: { path: skillPath, source: 'test', scope: 'user', origin: 'top-level' },
      }];
    },
  });

  usageTracker(pi);

  const ctx = {
    cwd: process.cwd(),
    sessionManager: { getSessionFile: () => '/tmp/session.jsonl' },
  };

  await pi.handlers.get('session_start')({}, ctx);
  await pi.handlers.get('tool_execution_start')({ toolCallId: 'tool-1', toolName: 'read', args: { path: skillPath } }, ctx);
  await pi.handlers.get('tool_execution_end')({ toolCallId: 'tool-1', toolName: 'read', result: {}, isError: true }, ctx);
  await pi.handlers.get('tool_execution_start')({ toolCallId: 'tool-2', toolName: 'read', args: { path: unregisteredPath } }, ctx);
  await pi.handlers.get('tool_execution_end')({ toolCallId: 'tool-2', toolName: 'read', result: {}, isError: false }, ctx);
  await pi.handlers.get('session_shutdown')({}, ctx);

  const db = openUsageAnalyticsDb({ dbPath, readOnly: true });
  try {
    const [{ n }] = db.prepare('SELECT COUNT(*) AS n FROM skill_loads').all();
    assert.equal(n, 0);
  } finally {
    db.close();
    delete process.env.PI_USAGE_ANALYTICS_DB_PATH;
  }
});

test('usage tracker disables collection after a corrupt database error', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-analytics-corrupt-'));
  const dbPath = join(tempDir, 'usage.sqlite');
  writeFileSync(dbPath, 'not a sqlite database');
  process.env.PI_USAGE_ANALYTICS_DB_PATH = dbPath;

  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    const pi = createMockPi([]);
    usageTracker(pi);

    const ctx = {
      cwd: process.cwd(),
      sessionManager: { getSessionFile: () => '/tmp/session.jsonl' },
    };

    await pi.handlers.get('input')({ text: '/skill:usage-analytics now', source: 'interactive' }, ctx);
    await pi.handlers.get('input')({ text: '/skill:usage-analytics again', source: 'interactive' }, ctx);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /collection disabled: database appears corrupt/);
    assert.match(errors[0], new RegExp(dbPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  } finally {
    console.error = originalConsoleError;
    delete process.env.PI_USAGE_ANALYTICS_DB_PATH;
  }
});

test('usage tracker disables collection after quick_check detects corruption', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-analytics-quick-check-'));
  const dbPath = join(tempDir, 'usage.sqlite');
  process.env.PI_USAGE_ANALYTICS_DB_PATH = dbPath;

  const db = openUsageAnalyticsDb({ dbPath });
  try {
    recordToolExecution(db, {
      ts: new Date().toISOString(),
      cwd: process.cwd(),
      toolCallId: 'tool-1',
      toolName: 'demo_tool',
      toolSource: 'extension',
      ok: true,
      durationMs: 1,
    });

    const [{ page_size: pageSize }] = db.prepare('PRAGMA page_size').all();
    const [{ rootpage }] = db.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'idx_tool_executions_ts'").all();
    db.close();
    corruptDatabasePage(dbPath, rootpage, pageSize);
  } catch (error) {
    try {
      db.close();
    } catch {}
    throw error;
  }

  const errors = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    errors.push(args.join(' '));
  };

  try {
    const pi = createMockPi([]);
    usageTracker(pi);

    const ctx = {
      cwd: process.cwd(),
      sessionManager: { getSessionFile: () => '/tmp/session.jsonl' },
    };

    await pi.handlers.get('input')({ text: '/skill:usage-analytics now', source: 'interactive' }, ctx);
    await pi.handlers.get('input')({ text: '/skill:usage-analytics again', source: 'interactive' }, ctx);

    assert.equal(errors.length, 1);
    assert.match(errors[0], /collection disabled: database appears corrupt/);
    assert.match(errors[0], /failed quick_check/);
  } finally {
    console.error = originalConsoleError;
    delete process.env.PI_USAGE_ANALYTICS_DB_PATH;
  }
});
