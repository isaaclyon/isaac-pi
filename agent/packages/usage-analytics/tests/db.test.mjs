import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openUsageAnalyticsDb, recordToolExecution } from '../src/db.mjs';

test('openUsageAnalyticsDb creates fresh databases in WAL mode for concurrent reads and writes', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-analytics-fresh-wal-'));
  const dbPath = join(tempDir, 'usage.sqlite');

  const db = openUsageAnalyticsDb({ dbPath });
  try {
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    recordToolExecution(db, {
      ts: new Date().toISOString(),
      cwd: tempDir,
      toolCallId: 'tool-1',
      toolName: 'demo_tool',
      toolSource: 'extension',
      ok: true,
      durationMs: 1,
    });
  } finally {
    db.close();
  }

  const reader = new DatabaseSync(dbPath, { readOnly: true });
  try {
    reader.exec('BEGIN');
    assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM tool_executions').get().n, 1);

    assert.doesNotThrow(() => {
      const writer = openUsageAnalyticsDb({ dbPath });
      try {
        recordToolExecution(writer, {
          ts: new Date().toISOString(),
          cwd: tempDir,
          toolCallId: 'tool-2',
          toolName: 'demo_tool',
          toolSource: 'extension',
          ok: true,
          durationMs: 1,
        });
      } finally {
        writer.close();
      }
    });
  } finally {
    reader.exec('ROLLBACK');
    reader.close();
  }
});

test('openUsageAnalyticsDb does not migrate journal mode while readers are active', () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'usage-analytics-wal-'));
  const dbPath = join(tempDir, 'usage.sqlite');

  const db = openUsageAnalyticsDb({ dbPath });
  try {
    recordToolExecution(db, {
      ts: new Date().toISOString(),
      cwd: tempDir,
      toolCallId: 'tool-1',
      toolName: 'demo_tool',
      toolSource: 'extension',
      ok: true,
      durationMs: 1,
    });
    db.prepare('PRAGMA journal_mode = WAL').get();
  } finally {
    db.close();
  }

  const reader = new DatabaseSync(dbPath, { readOnly: true });
  try {
    reader.exec('BEGIN');
    assert.equal(reader.prepare('SELECT COUNT(*) AS n FROM tool_executions').get().n, 1);

    assert.doesNotThrow(() => {
      const writer = openUsageAnalyticsDb({ dbPath });
      try {
        assert.equal(writer.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
      } finally {
        writer.close();
      }
    });
  } finally {
    reader.exec('ROLLBACK');
    reader.close();
  }
});
