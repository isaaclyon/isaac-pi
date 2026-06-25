function repoPredicate(column, repoRoot) {
  if (repoRoot === undefined) return { sql: '', params: {} };
  if (repoRoot === null) return { sql: `${column} IS NULL`, params: {} };
  return { sql: `${column} = :repo_root`, params: { repo_root: repoRoot } };
}

function buildWhere(parts) {
  const active = parts.filter(Boolean);
  return active.length === 0 ? '' : `WHERE ${active.join(' AND ')}`;
}

function buildEventFilter(column, options) {
  const clauses = [];
  const params = {};

  const repo = repoPredicate(column, options.repoRoot);
  if (repo.sql) clauses.push(repo.sql);
  Object.assign(params, repo.params);

  if (options.days) {
    clauses.push(`datetime(${options.timeColumn ?? 'ts'}) >= datetime('now', :days_window)`);
    params.days_window = `-${options.days} days`;
  }

  return { where: buildWhere(clauses), params };
}

function numberLike(value) {
  return typeof value === 'number' || (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value));
}

export function formatRowsAsTable(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '(no rows)';

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const widths = Object.fromEntries(
    columns.map((column) => [
      column,
      Math.max(
        column.length,
        ...rows.map((row) => String(row[column] ?? '').length),
      ),
    ]),
  );

  const renderCell = (column, value) => {
    const text = value == null ? '' : String(value);
    return numberLike(value) ? text.padStart(widths[column]) : text.padEnd(widths[column]);
  };

  const header = columns.map((column) => column.padEnd(widths[column])).join(' | ');
  const divider = columns.map((column) => '-'.repeat(widths[column])).join('-|-');
  const body = rows.map((row) => columns.map((column) => renderCell(column, row[column])).join(' | '));

  return [header, divider, ...body].join('\n');
}

export function renderReport(rows, format) {
  return format === 'json' ? JSON.stringify(rows, null, 2) : formatRowsAsTable(rows);
}

export function runCannedReport(db, name, options = {}) {
  const limit = Number.isFinite(options.limit) ? options.limit : 20;

  switch (name) {
    case 'summary': {
      const skillFilter = buildEventFilter('repo_root', options);
      const toolFilter = buildEventFilter('repo_root', options);
      return db.prepare(`
        SELECT 'skill_invocations' AS metric, COUNT(*) AS value FROM skill_invocations ${skillFilter.where}
        UNION ALL
        SELECT 'tool_executions' AS metric, COUNT(*) AS value FROM tool_executions ${toolFilter.where}
        UNION ALL
        SELECT 'tool_failures' AS metric, COUNT(*) AS value FROM tool_executions ${buildWhere([toolFilter.where.replace(/^WHERE\s*/, ''), 'ok = 0'].filter(Boolean))}
        UNION ALL
        SELECT 'extension_tool_executions' AS metric, COUNT(*) AS value FROM tool_executions ${buildWhere([toolFilter.where.replace(/^WHERE\s*/, ''), "tool_source = 'extension'"].filter(Boolean))}
      `).all({ ...skillFilter.params, ...toolFilter.params });
    }

    case 'skills': {
      const filter = buildEventFilter('repo_root', options);
      return db.prepare(`
        SELECT skill_name, COUNT(*) AS invocation_count, MAX(ts) AS last_seen
        FROM skill_invocations
        ${filter.where}
        GROUP BY skill_name
        ORDER BY invocation_count DESC, last_seen DESC, skill_name ASC
        LIMIT :limit
      `).all({ ...filter.params, limit });
    }

    case 'tools': {
      const filter = buildEventFilter('repo_root', options);
      return db.prepare(`
        SELECT tool_name, tool_source, COUNT(*) AS execution_count, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failure_count, ROUND(AVG(duration_ms), 1) AS avg_duration_ms, MAX(ts) AS last_seen
        FROM tool_executions
        ${filter.where}
        GROUP BY tool_name, tool_source
        ORDER BY execution_count DESC, last_seen DESC, tool_name ASC
        LIMIT :limit
      `).all({ ...filter.params, limit });
    }

    case 'extension-tools': {
      const filter = buildEventFilter('repo_root', options);
      return db.prepare(`
        SELECT tool_name, COUNT(*) AS execution_count, SUM(CASE WHEN ok = 0 THEN 1 ELSE 0 END) AS failure_count, ROUND(AVG(duration_ms), 1) AS avg_duration_ms, MAX(ts) AS last_seen
        FROM tool_executions
        ${buildWhere([filter.where.replace(/^WHERE\s*/, ''), "tool_source = 'extension'"].filter(Boolean))}
        GROUP BY tool_name
        ORDER BY execution_count DESC, last_seen DESC, tool_name ASC
        LIMIT :limit
      `).all({ ...filter.params, limit });
    }

    case 'failures': {
      const filter = buildEventFilter('repo_root', options);
      return db.prepare(`
        SELECT tool_name, tool_source, COUNT(*) AS failure_count, MAX(ts) AS last_failure_at
        FROM tool_executions
        ${buildWhere([filter.where.replace(/^WHERE\s*/, ''), 'ok = 0'].filter(Boolean))}
        GROUP BY tool_name, tool_source
        ORDER BY failure_count DESC, last_failure_at DESC, tool_name ASC
        LIMIT :limit
      `).all({ ...filter.params, limit });
    }

    case 'slow-tools': {
      const filter = buildEventFilter('repo_root', options);
      return db.prepare(`
        SELECT tool_name, tool_source, COUNT(*) AS execution_count, ROUND(AVG(duration_ms), 1) AS avg_duration_ms, MAX(duration_ms) AS max_duration_ms, MAX(ts) AS last_seen
        FROM tool_executions
        ${filter.where}
        GROUP BY tool_name, tool_source
        ORDER BY avg_duration_ms DESC, max_duration_ms DESC, execution_count DESC, tool_name ASC
        LIMIT :limit
      `).all({ ...filter.params, limit });
    }

    case 'repos': {
      const skillFilter = buildEventFilter('repo_root', options);
      const toolFilter = buildEventFilter('repo_root', options);
      return db.prepare(`
        WITH repo_skill_counts AS (
          SELECT repo_root, COUNT(*) AS skill_invocations
          FROM skill_invocations
          ${skillFilter.where}
          GROUP BY repo_root
        ),
        repo_tool_counts AS (
          SELECT repo_root, COUNT(*) AS tool_executions
          FROM tool_executions
          ${toolFilter.where}
          GROUP BY repo_root
        ),
        repos AS (
          SELECT repo_root FROM repo_skill_counts
          UNION
          SELECT repo_root FROM repo_tool_counts
        )
        SELECT
          COALESCE(repos.repo_root, '(no repo)') AS repo_root,
          COALESCE(repo_skill_counts.skill_invocations, 0) AS skill_invocations,
          COALESCE(repo_tool_counts.tool_executions, 0) AS tool_executions,
          COALESCE(repo_skill_counts.skill_invocations, 0) + COALESCE(repo_tool_counts.tool_executions, 0) AS total_events
        FROM repos
        LEFT JOIN repo_skill_counts ON repo_skill_counts.repo_root IS repos.repo_root
        LEFT JOIN repo_tool_counts ON repo_tool_counts.repo_root IS repos.repo_root
        ORDER BY total_events DESC, repo_root ASC
        LIMIT :limit
      `).all({ ...skillFilter.params, ...toolFilter.params, limit });
    }

    default:
      throw new Error(`Unknown report: ${name}`);
  }
}
