#!/usr/bin/env node
import { resolve } from 'node:path';
import { ensureUsageAnalyticsDb, openUsageAnalyticsDb } from '../src/db.mjs';
import { getPiRepoRoot, resolveRepoRootFromPath } from '../src/repo.mjs';
import { runCannedReport, renderReport } from '../src/reports.mjs';
import { ensureReadOnlySql } from '../src/sql.mjs';

const REPORT_NAMES = ['summary', 'skills', 'skill-loads', 'tools', 'extension-tools', 'failures', 'slow-tools', 'repos'];

function printUsage() {
  console.error(`Usage:
  usage-query.mjs [summary|skills|skill-loads|tools|extension-tools|failures|slow-tools|repos] [--scope=current|all] [--repo PATH] [--days N] [--limit N] [--format=table|json]
  usage-query.mjs sql "SELECT ..." [--format=table|json]`);
}

function parseArgs(argv) {
  const [command = 'summary', ...rest] = argv;
  const flags = {};
  const positionals = [];

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];
    if (!arg.startsWith('--')) {
      positionals.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split('=', 2);
    const value = inlineValue ?? rest[++index];
    flags[rawKey] = value;
  }

  return { command, flags, positionals };
}

function resolveRepoScope(scope, repoArg) {
  const piRepoRoot = getPiRepoRoot();
  if (repoArg) {
    const repoRoot = resolveRepoRootFromPath(repoArg) ?? resolve(repoArg);
    if (repoRoot !== piRepoRoot) {
      throw new Error(`Usage analytics is limited to ${piRepoRoot}`);
    }
    return piRepoRoot;
  }

  if (scope === 'current') {
    const repoRoot = resolveRepoRootFromPath(process.cwd());
    if (!repoRoot) {
      throw new Error(`No git repo found for ${process.cwd()}`);
    }
    if (repoRoot !== piRepoRoot) {
      throw new Error(`Usage analytics is limited to ${piRepoRoot}`);
    }
    return repoRoot;
  }

  return piRepoRoot;
}

function main() {
  const { command, flags, positionals } = parseArgs(process.argv.slice(2));
  if (command === '--help' || command === '-h' || flags.help) {
    printUsage();
    process.exit(0);
  }

  const format = flags.format ?? 'table';
  const scope = flags.scope ?? 'all';
  const options = {
    days: flags.days ? Number(flags.days) : undefined,
    limit: flags.limit ? Number(flags.limit) : 20,
    repoRoot: resolveRepoScope(scope, flags.repo),
  };

  if (!['table', 'json'].includes(format)) {
    throw new Error(`Unsupported format: ${format}`);
  }

  ensureUsageAnalyticsDb();
  const db = openUsageAnalyticsDb({ readOnly: true });

  try {
    let rows;

    if (command === 'sql') {
      const sql = ensureReadOnlySql(positionals.join(' '));
      rows = db.prepare(sql).all();
    } else if (REPORT_NAMES.includes(command)) {
      rows = runCannedReport(db, command, options);
    } else {
      printUsage();
      throw new Error(`Unknown command: ${command}`);
    }

    console.log(renderReport(rows, format));
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
