import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const SKILL_COMMAND_RE = /(?:^|\n)\s*\/skill:([A-Za-z0-9][\w.-]*)\b/g;

export function extractExplicitSkillInvocations(input) {
  if (typeof input !== 'string' || input.trim() === '') return [];

  const matches = [];
  for (const match of input.matchAll(SKILL_COMMAND_RE)) {
    matches.push(match[1]);
  }
  return matches;
}

export function resolveRepoRootFromPath(cwd, options = {}) {
  if (typeof cwd !== 'string' || cwd.trim() === '') return null;

  const spawn = options.spawnSync ?? spawnSync;
  const result = spawn('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });

  if (result.status !== 0) return null;

  const repoRoot = result.stdout.trim();
  return repoRoot ? resolve(repoRoot) : null;
}

export function getPiRepoRoot(home = homedir()) {
  const piPath = join(home, '.pi');
  return resolveRepoRootFromPath(piPath) ?? resolve(piPath);
}

export function isPiRepo(repoRoot, home = homedir()) {
  return typeof repoRoot === 'string' && resolve(repoRoot) === getPiRepoRoot(home);
}
