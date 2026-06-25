import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { extractExplicitSkillInvocations, resolveRepoRootFromPath } from '../src/repo.mjs';

test('extractExplicitSkillInvocations only matches explicit skill commands', () => {
  assert.deepEqual(
    extractExplicitSkillInvocations('hello\n/skill:repo-intelligence\n/skill:usage-analytics now'),
    ['repo-intelligence', 'usage-analytics'],
  );
  assert.deepEqual(extractExplicitSkillInvocations('mention /skill:repo-intelligence in prose'), []);
});

test('resolveRepoRootFromPath returns git top level when available', () => {
  const root = mkdtempSync(join(tmpdir(), 'usage-analytics-repo-'));
  const nested = join(root, 'a', 'b');
  mkdirSync(nested, { recursive: true });

  const fakeSpawn = (_cmd, _args) => ({ status: 0, stdout: `${root}\n` });
  assert.equal(resolveRepoRootFromPath(nested, { spawnSync: fakeSpawn }), root);
});

test('resolveRepoRootFromPath returns null when git lookup fails', () => {
  const fakeSpawn = () => ({ status: 128, stdout: '' });
  assert.equal(resolveRepoRootFromPath('/tmp/not-a-repo', { spawnSync: fakeSpawn }), null);
});
