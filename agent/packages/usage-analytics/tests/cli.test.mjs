import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const scriptPath = new URL('../scripts/usage-query.mjs', import.meta.url).pathname;

function runCli(args, env) {
  return execFileSync(process.execPath, [scriptPath, ...args], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
}

test('sql CLI executes plain read-only queries', () => {
  const home = mkdtempSync(join(tmpdir(), 'usage-analytics-home-'));
  const dbPath = join(home, '.pi', 'agent', 'state', 'usage-analytics', 'usage-analytics.sqlite');
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE demo (value TEXT) STRICT; INSERT INTO demo(value) VALUES (\'ok\');');
  db.close();

  const output = runCli(['sql', 'SELECT value FROM demo', '--format=json'], { HOME: home });
  assert.match(output, /"value": "ok"/);
});
