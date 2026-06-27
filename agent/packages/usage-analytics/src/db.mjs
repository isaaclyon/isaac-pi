import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_DB_PATH = join(homedir(), '.pi', 'agent', 'state', 'usage-analytics', 'usage-analytics.sqlite');

const SCHEMA_SQL = `
PRAGMA busy_timeout = 5000;
PRAGMA synchronous = FULL;

CREATE TABLE IF NOT EXISTS skill_invocations (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  session_file TEXT,
  cwd TEXT NOT NULL,
  repo_root TEXT,
  skill_name TEXT NOT NULL,
  raw_input TEXT NOT NULL
) STRICT;

CREATE TABLE IF NOT EXISTS skill_loads (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  session_file TEXT,
  cwd TEXT NOT NULL,
  repo_root TEXT,
  skill_name TEXT NOT NULL,
  skill_path TEXT,
  load_source TEXT NOT NULL CHECK (load_source IN ('explicit_command', 'skill_file_read')),
  tool_call_id TEXT,
  raw_input TEXT
) STRICT;

CREATE TABLE IF NOT EXISTS tool_executions (
  id INTEGER PRIMARY KEY,
  ts TEXT NOT NULL,
  session_file TEXT,
  cwd TEXT NOT NULL,
  repo_root TEXT,
  tool_call_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  tool_source TEXT NOT NULL CHECK (tool_source IN ('extension', 'non_extension')),
  tool_path TEXT,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  duration_ms INTEGER NOT NULL CHECK (duration_ms >= 0)
) STRICT;

CREATE INDEX IF NOT EXISTS idx_skill_invocations_ts ON skill_invocations(ts);
CREATE INDEX IF NOT EXISTS idx_skill_invocations_repo_root ON skill_invocations(repo_root);
CREATE INDEX IF NOT EXISTS idx_skill_invocations_skill_name ON skill_invocations(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_loads_ts ON skill_loads(ts);
CREATE INDEX IF NOT EXISTS idx_skill_loads_repo_root ON skill_loads(repo_root);
CREATE INDEX IF NOT EXISTS idx_skill_loads_skill_name ON skill_loads(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_loads_load_source ON skill_loads(load_source);
CREATE INDEX IF NOT EXISTS idx_tool_executions_ts ON tool_executions(ts);
CREATE INDEX IF NOT EXISTS idx_tool_executions_repo_root ON tool_executions(repo_root);
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_name ON tool_executions(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_executions_tool_source ON tool_executions(tool_source);

CREATE VIEW IF NOT EXISTS v_skill_counts AS
SELECT
  repo_root,
  skill_name,
  COUNT(*) AS invocation_count,
  MAX(ts) AS last_seen
FROM skill_invocations
GROUP BY repo_root, skill_name;

CREATE VIEW IF NOT EXISTS v_tool_counts AS
SELECT
  repo_root,
  tool_name,
  tool_source,
  tool_path,
  COUNT(*) AS execution_count,
  SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failure_count,
  ROUND(AVG(duration_ms), 1) AS avg_duration_ms,
  MAX(ts) AS last_seen
FROM tool_executions
GROUP BY repo_root, tool_name, tool_source, tool_path;

CREATE VIEW IF NOT EXISTS v_extension_tool_counts AS
SELECT *
FROM v_tool_counts
WHERE tool_source = 'extension';

CREATE VIEW IF NOT EXISTS v_tool_failures AS
SELECT
  repo_root,
  tool_name,
  tool_source,
  tool_path,
  COUNT(*) AS failure_count,
  MAX(ts) AS last_failure_at
FROM tool_executions
WHERE ok = 0
GROUP BY repo_root, tool_name, tool_source, tool_path;

CREATE VIEW IF NOT EXISTS v_tool_latency AS
SELECT
  repo_root,
  tool_name,
  tool_source,
  tool_path,
  COUNT(*) AS execution_count,
  ROUND(AVG(duration_ms), 1) AS avg_duration_ms,
  MAX(duration_ms) AS max_duration_ms,
  MAX(ts) AS last_seen
FROM tool_executions
GROUP BY repo_root, tool_name, tool_source, tool_path;

CREATE VIEW IF NOT EXISTS v_repo_counts AS
SELECT
  repos.repo_root AS repo_root,
  COALESCE(skills.skill_invocations, 0) AS skill_invocations,
  COALESCE(skill_loads.observed_skill_file_reads, 0) AS observed_skill_file_reads,
  COALESCE(tools.tool_executions, 0) AS tool_executions,
  COALESCE(skills.skill_invocations, 0) + COALESCE(skill_loads.observed_skill_file_reads, 0) + COALESCE(tools.tool_executions, 0) AS total_events
FROM (
  SELECT repo_root FROM skill_invocations
  UNION
  SELECT repo_root FROM skill_loads WHERE load_source = 'skill_file_read'
  UNION
  SELECT repo_root FROM tool_executions
) AS repos
LEFT JOIN (
  SELECT repo_root, COUNT(*) AS skill_invocations
  FROM skill_invocations
  GROUP BY repo_root
) AS skills ON skills.repo_root IS repos.repo_root
LEFT JOIN (
  SELECT repo_root, COUNT(*) AS observed_skill_file_reads
  FROM skill_loads
  WHERE load_source = 'skill_file_read'
  GROUP BY repo_root
) AS skill_loads ON skill_loads.repo_root IS repos.repo_root
LEFT JOIN (
  SELECT repo_root, COUNT(*) AS tool_executions
  FROM tool_executions
  GROUP BY repo_root
) AS tools ON tools.repo_root IS repos.repo_root;

CREATE VIEW IF NOT EXISTS v_repo_skill_counts AS
SELECT repo_root, skill_name, COUNT(*) AS invocation_count, MAX(ts) AS last_seen
FROM skill_invocations
GROUP BY repo_root, skill_name;

CREATE VIEW IF NOT EXISTS v_repo_tool_counts AS
SELECT repo_root, tool_name, tool_source, tool_path, COUNT(*) AS execution_count, MAX(ts) AS last_seen
FROM tool_executions
GROUP BY repo_root, tool_name, tool_source, tool_path;
`;

export function isSqliteCorruptionError(error) {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return text.includes('SQLITE_CORRUPT')
    || text.includes('database disk image is malformed')
    || text.includes('file is not a database')
    || text.includes('failed quick_check');
}

function assertDatabaseIntegrity(db) {
  const rows = db.prepare('PRAGMA quick_check').all();
  if (rows.length === 1 && rows[0]?.quick_check === 'ok') return;

  const details = rows.map((row) => row.quick_check).filter(Boolean).join('; ');
  throw new Error(`usage analytics database failed quick_check: ${details || 'unknown error'}`);
}

export function getUsageAnalyticsDbPath() {
  return process.env.PI_USAGE_ANALYTICS_DB_PATH || DEFAULT_DB_PATH;
}

export function bootstrapSchema(db) {
  db.exec(SCHEMA_SQL);
}

export function openUsageAnalyticsDb(options = {}) {
  const dbPath = options.dbPath || getUsageAnalyticsDbPath();
  const dbExisted = existsSync(dbPath);

  if (!options.readOnly) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new DatabaseSync(dbPath, {
    readOnly: options.readOnly ?? false,
    timeout: 2000,
    enableForeignKeyConstraints: true,
  });

  if (!options.readOnly) {
    try {
      db.exec('PRAGMA busy_timeout = 5000;');
      if (!dbExisted) {
        db.prepare('PRAGMA journal_mode = WAL').get();
      }
      bootstrapSchema(db);
      assertDatabaseIntegrity(db);
    } catch (error) {
      try {
        db.close();
      } catch {}
      throw error;
    }
  }

  return db;
}

export function ensureUsageAnalyticsDb(options = {}) {
  const dbPath = options.dbPath || getUsageAnalyticsDbPath();
  const db = openUsageAnalyticsDb({ dbPath });
  db.close();
  return dbPath;
}

export function recordSkillInvocation(db, row) {
  db.prepare(`
    INSERT INTO skill_invocations (ts, session_file, cwd, repo_root, skill_name, raw_input)
    VALUES (:ts, :session_file, :cwd, :repo_root, :skill_name, :raw_input)
  `).run({
    ts: row.ts,
    session_file: row.sessionFile ?? null,
    cwd: row.cwd,
    repo_root: row.repoRoot ?? null,
    skill_name: row.skillName,
    raw_input: row.rawInput,
  });
}

export function recordSkillLoad(db, row) {
  db.prepare(`
    INSERT INTO skill_loads (
      ts, session_file, cwd, repo_root, skill_name, skill_path, load_source, tool_call_id, raw_input
    ) VALUES (
      :ts, :session_file, :cwd, :repo_root, :skill_name, :skill_path, :load_source, :tool_call_id, :raw_input
    )
  `).run({
    ts: row.ts,
    session_file: row.sessionFile ?? null,
    cwd: row.cwd,
    repo_root: row.repoRoot ?? null,
    skill_name: row.skillName,
    skill_path: row.skillPath ?? null,
    load_source: row.loadSource,
    tool_call_id: row.toolCallId ?? null,
    raw_input: row.rawInput ?? null,
  });
}

export function recordToolExecution(db, row) {
  db.prepare(`
    INSERT INTO tool_executions (
      ts, session_file, cwd, repo_root, tool_call_id, tool_name, tool_source, tool_path, ok, duration_ms
    ) VALUES (
      :ts, :session_file, :cwd, :repo_root, :tool_call_id, :tool_name, :tool_source, :tool_path, :ok, :duration_ms
    )
  `).run({
    ts: row.ts,
    session_file: row.sessionFile ?? null,
    cwd: row.cwd,
    repo_root: row.repoRoot ?? null,
    tool_call_id: row.toolCallId,
    tool_name: row.toolName,
    tool_source: row.toolSource,
    tool_path: row.toolPath ?? null,
    ok: row.ok ? 1 : 0,
    duration_ms: row.durationMs,
  });
}
