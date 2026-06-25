const FORBIDDEN_SQL_RE = /\b(attach|alter|analyze|begin|commit|create|delete|detach|drop|insert|load_extension|pragma|reindex|release|replace|rollback|savepoint|update|vacuum)\b/i;
const READ_ONLY_SQL_RE = /^(select|with|explain\s+(query\s+plan\s+)?select|explain\s+(query\s+plan\s+)?with)\b/i;

function stripLeadingComments(sql) {
  let value = sql.trim();

  while (true) {
    if (value.startsWith('--')) {
      const nextNewline = value.indexOf('\n');
      value = nextNewline === -1 ? '' : value.slice(nextNewline + 1).trimStart();
      continue;
    }

    if (value.startsWith('/*')) {
      const end = value.indexOf('*/');
      value = end === -1 ? '' : value.slice(end + 2).trimStart();
      continue;
    }

    return value;
  }
}

function stripSqlStringsAndComments(sql) {
  let output = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];
    const next = sql[index + 1];

    if (char === "'") {
      output += "''";
      index += 1;
      while (index < sql.length) {
        if (sql[index] === "'" && sql[index + 1] === "'") {
          index += 2;
          continue;
        }
        if (sql[index] === "'") {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '"') {
      output += '""';
      index += 1;
      while (index < sql.length) {
        if (sql[index] === '"' && sql[index + 1] === '"') {
          index += 2;
          continue;
        }
        if (sql[index] === '"') {
          index += 1;
          break;
        }
        index += 1;
      }
      continue;
    }

    if (char === '[') {
      output += '[]';
      index += 1;
      while (index < sql.length && sql[index] !== ']') {
        index += 1;
      }
      index += 1;
      continue;
    }

    if (char === '-' && next === '-') {
      index += 2;
      while (index < sql.length && sql[index] !== '\n') {
        index += 1;
      }
      continue;
    }

    if (char === '/' && next === '*') {
      index += 2;
      while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
        index += 1;
      }
      index += 2;
      continue;
    }

    output += char;
    index += 1;
  }

  return output;
}

export function validateReadOnlySql(sql) {
  if (typeof sql !== 'string' || sql.trim() === '') {
    return { ok: false, reason: 'SQL is required.' };
  }

  const normalized = stripLeadingComments(sql);
  if (!normalized) {
    return { ok: false, reason: 'SQL is required.' };
  }

  const withoutTrailingSemicolon = normalized.replace(/;\s*$/, '').trimEnd();
  const structuralSql = stripSqlStringsAndComments(withoutTrailingSemicolon);
  if (structuralSql.includes(';')) {
    return { ok: false, reason: 'Only a single SQL statement is allowed.' };
  }

  if (!READ_ONLY_SQL_RE.test(withoutTrailingSemicolon)) {
    return { ok: false, reason: 'Only SELECT/CTE queries are allowed.' };
  }

  if (FORBIDDEN_SQL_RE.test(structuralSql)) {
    return { ok: false, reason: 'Write or admin SQL is not allowed.' };
  }

  return { ok: true, sql: withoutTrailingSemicolon };
}

export function ensureReadOnlySql(sql) {
  const result = validateReadOnlySql(sql);
  if (!result.ok) {
    throw new Error(result.reason);
  }
  return result.sql;
}
