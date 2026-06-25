import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUsageAnalyticsDb, recordSkillInvocation } from '../src/db.mjs';
import { formatRowsAsTable, runCannedReport } from '../src/reports.mjs';

test('formatRowsAsTable renders headers and values', () => {
  const table = formatRowsAsTable([
    { skill_name: 'usage-analytics', invocation_count: 12 },
    { skill_name: 'repo-intelligence', invocation_count: 3 },
  ]);

  assert.match(table, /skill_name\s+\| invocation_count/);
  assert.match(table, /usage-analytics\s+\|\s+12/);
  assert.match(table, /repo-intelligence\s+\|\s+3/);
});

test('formatRowsAsTable returns a friendly empty state', () => {
  assert.equal(formatRowsAsTable([]), '(no rows)');
});

test('runCannedReport respects days filters against ISO timestamps', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'usage-analytics-db-')), 'usage.sqlite');
  const db = openUsageAnalyticsDb({ dbPath });

  try {
    recordSkillInvocation(db, {
      ts: '2000-01-01T00:00:00.000Z',
      sessionFile: null,
      cwd: '/tmp',
      repoRoot: null,
      skillName: 'old-skill',
      rawInput: '/skill:old-skill',
    });
    recordSkillInvocation(db, {
      ts: new Date().toISOString(),
      sessionFile: null,
      cwd: '/tmp',
      repoRoot: null,
      skillName: 'new-skill',
      rawInput: '/skill:new-skill',
    });

    const rows = runCannedReport(db, 'skills', { days: 1, limit: 10 });
    assert.deepEqual(rows.map((row) => row.skill_name), ['new-skill']);
  } finally {
    db.close();
  }
});
