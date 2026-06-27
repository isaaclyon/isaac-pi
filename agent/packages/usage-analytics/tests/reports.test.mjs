import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openUsageAnalyticsDb, recordSkillInvocation, recordSkillLoad } from '../src/db.mjs';
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

test('runCannedReport summarizes observed skill loads separately', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'usage-analytics-loads-')), 'usage.sqlite');
  const db = openUsageAnalyticsDb({ dbPath });

  try {
    recordSkillLoad(db, {
      ts: '2026-01-01T00:00:00.000Z',
      sessionFile: null,
      cwd: '/tmp',
      repoRoot: null,
      skillName: 'usage-analytics',
      skillPath: null,
      loadSource: 'explicit_command',
      toolCallId: null,
      rawInput: '/skill:usage-analytics',
    });
    recordSkillLoad(db, {
      ts: '2026-01-01T00:00:01.000Z',
      sessionFile: null,
      cwd: '/tmp',
      repoRoot: null,
      skillName: 'usage-analytics',
      skillPath: '/tmp/skills/usage-analytics/SKILL.md',
      loadSource: 'skill_file_read',
      toolCallId: 'tool-1',
      rawInput: null,
    });

    const rows = runCannedReport(db, 'skill-loads', { limit: 10 });
    assert.deepEqual(rows.map((row) => ({ skill_name: row.skill_name, load_source: row.load_source, load_count: row.load_count })), [
      { skill_name: 'usage-analytics', load_source: 'skill_file_read', load_count: 1 },
      { skill_name: 'usage-analytics', load_source: 'explicit_command', load_count: 1 },
    ]);
  } finally {
    db.close();
  }
});

test('repos report includes repos with only observed skill file reads', () => {
  const dbPath = join(mkdtempSync(join(tmpdir(), 'usage-analytics-repo-loads-')), 'usage.sqlite');
  const db = openUsageAnalyticsDb({ dbPath });

  try {
    recordSkillLoad(db, {
      ts: '2026-01-01T00:00:00.000Z',
      sessionFile: null,
      cwd: '/repo',
      repoRoot: '/repo',
      skillName: 'usage-analytics',
      skillPath: '/repo/.pi/skills/usage-analytics/SKILL.md',
      loadSource: 'skill_file_read',
      toolCallId: 'tool-1',
      rawInput: null,
    });

    const rows = runCannedReport(db, 'repos', { limit: 10 });
    assert.deepEqual(rows.map((row) => ({
      repo_root: row.repo_root,
      skill_invocations: row.skill_invocations,
      observed_skill_file_reads: row.observed_skill_file_reads,
      tool_executions: row.tool_executions,
      total_events: row.total_events,
    })), [{
      repo_root: '/repo',
      skill_invocations: 0,
      observed_skill_file_reads: 1,
      tool_executions: 0,
      total_events: 1,
    }]);
  } finally {
    db.close();
  }
});
