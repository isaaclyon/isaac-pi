import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  getUsageAnalyticsDbPath,
  isSqliteCorruptionError,
  openUsageAnalyticsDb,
  recordSkillInvocation,
  recordSkillLoad,
  recordToolExecution,
} from "../src/db.mjs";
import { extractExplicitSkillInvocations, resolveRepoRootFromPath } from "../src/repo.mjs";

interface SkillFileLoad {
  skillName: string;
  skillPath: string;
}

interface PendingToolExecution {
  startedAt: number;
  cwd: string;
  repoRoot: string | null;
  sessionFile: string | null;
  toolName: string;
  toolPath: string | null;
  toolSource: 'extension' | 'non_extension';
  skillFileLoad: SkillFileLoad | null;
}

function classifyTool(tool: ToolInfo | undefined): Pick<PendingToolExecution, 'toolPath' | 'toolSource'> {
  const toolPath = tool?.sourceInfo.path ?? null;
  const source = tool?.sourceInfo.source;
  const toolSource = source && source !== 'builtin' && source !== 'sdk' ? 'extension' : 'non_extension';
  return { toolPath, toolSource };
}

function expandHome(path: string) {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function normalizeFilePath(path: unknown, baseDir: string) {
  if (typeof path !== 'string' || path.length === 0) return null;

  const withoutMention = path.startsWith('@') ? path.slice(1) : path;
  const expanded = expandHome(withoutMention);
  const absolute = isAbsolute(expanded) ? expanded : resolve(baseDir, expanded);

  try {
    return realpathSync.native(absolute);
  } catch {
    return absolute;
  }
}

function commandSkillName(commandName: string) {
  return commandName.replace(/^skill:/, '');
}

function commandSkillPath(command: { sourceInfo?: { path?: string; baseDir?: string } }, cwd: string) {
  const path = command.sourceInfo?.path;
  if (!path) return null;
  return normalizeFilePath(path, command.sourceInfo?.baseDir ?? cwd);
}

function readPathFromArgs(args: unknown) {
  if (!args || typeof args !== 'object') return null;
  const path = (args as { path?: unknown }).path;
  return typeof path === 'string' ? path : null;
}

export default function usageTracker(pi: ExtensionAPI) {
  const pendingExecutions = new Map<string, PendingToolExecution>();
  const repoRootCache = new Map<string, string | null>();
  let toolsByName = new Map<string, ToolInfo>();
  let skillsByPath = new Map<string, SkillFileLoad>();
  let db = null;
  let collectionDisabled = false;

  function logDbError(error: unknown) {
    if (isSqliteCorruptionError(error)) {
      if (!collectionDisabled) {
        collectionDisabled = true;
        console.error(
          `[usage-analytics] collection disabled: database appears corrupt at ${getUsageAnalyticsDbPath()}. `
          + `Recover or reset it before restarting collection. Cause: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }

    console.error('[usage-analytics] collector write failed:', error instanceof Error ? error.message : String(error));
  }

  function getDb() {
    if (collectionDisabled) return null;
    if (db) return db;

    try {
      db = openUsageAnalyticsDb();
      return db;
    } catch (error) {
      logDbError(error);
      return null;
    }
  }

  function safelyRecord(write: (db: NonNullable<typeof db>) => void) {
    if (collectionDisabled) return;

    const currentDb = getDb();
    if (!currentDb) return;

    try {
      write(currentDb);
    } catch (error) {
      try {
        currentDb.close();
      } catch {}
      db = null;
      logDbError(error);
    }
  }

  function getRepoRoot(cwd: string) {
    if (!repoRootCache.has(cwd)) {
      repoRootCache.set(cwd, resolveRepoRootFromPath(cwd));
    }
    return repoRootCache.get(cwd) ?? null;
  }

  function refreshTools() {
    toolsByName = new Map(pi.getAllTools().map((tool) => [tool.name, tool]));
  }

  function refreshSkills(cwd: string) {
    const next = new Map<string, SkillFileLoad>();
    const commands = pi.getCommands?.() ?? [];

    for (const command of commands) {
      if (command.source !== 'skill') continue;

      const skillPath = commandSkillPath(command, cwd);
      if (!skillPath) continue;

      next.set(skillPath, {
        skillName: commandSkillName(command.name),
        skillPath,
      });
    }

    skillsByPath = next;
  }

  function findSkillFileLoad(path: unknown, cwd: string) {
    const normalizedPath = normalizeFilePath(path, cwd);
    if (!normalizedPath) return null;

    let skillFileLoad = skillsByPath.get(normalizedPath) ?? null;
    if (!skillFileLoad) {
      refreshSkills(cwd);
      skillFileLoad = skillsByPath.get(normalizedPath) ?? null;
    }
    return skillFileLoad;
  }

  pi.on('session_start', async (_event, ctx) => {
    refreshTools();
    refreshSkills(ctx.cwd);
  });

  pi.on('input', async (event, ctx) => {
    const skillNames = extractExplicitSkillInvocations(event.text);
    if (skillNames.length === 0) return;

    const ts = new Date().toISOString();
    const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
    const repoRoot = getRepoRoot(ctx.cwd);

    for (const skillName of skillNames) {
      safelyRecord((currentDb) => {
        recordSkillInvocation(currentDb, {
          ts,
          sessionFile,
          cwd: ctx.cwd,
          repoRoot,
          skillName,
          rawInput: event.text,
        });
        recordSkillLoad(currentDb, {
          ts,
          sessionFile,
          cwd: ctx.cwd,
          repoRoot,
          skillName,
          skillPath: null,
          loadSource: 'explicit_command',
          toolCallId: null,
          rawInput: event.text,
        });
      });
    }
  });

  pi.on('tool_execution_start', async (event, ctx) => {
    if (!toolsByName.has(event.toolName)) {
      refreshTools();
    }

    const tool = toolsByName.get(event.toolName);
    const { toolPath, toolSource } = classifyTool(tool);

    pendingExecutions.set(event.toolCallId, {
      startedAt: Date.now(),
      cwd: ctx.cwd,
      repoRoot: getRepoRoot(ctx.cwd),
      sessionFile: ctx.sessionManager.getSessionFile() ?? null,
      toolName: event.toolName,
      toolPath,
      toolSource,
      skillFileLoad: event.toolName === 'read' ? findSkillFileLoad(readPathFromArgs(event.args), ctx.cwd) : null,
    });
  });

  pi.on('tool_execution_end', async (event) => {
    const pending = pendingExecutions.get(event.toolCallId);
    pendingExecutions.delete(event.toolCallId);
    if (!pending) return;

    const endedAt = Date.now();
    safelyRecord((currentDb) => {
      recordToolExecution(currentDb, {
        ts: new Date(endedAt).toISOString(),
        sessionFile: pending.sessionFile,
        cwd: pending.cwd,
        repoRoot: pending.repoRoot,
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        toolSource: pending.toolSource,
        toolPath: pending.toolPath,
        ok: !event.isError,
        durationMs: Math.max(0, endedAt - pending.startedAt),
      });

      if (!event.isError && pending.skillFileLoad) {
        recordSkillLoad(currentDb, {
          ts: new Date(endedAt).toISOString(),
          sessionFile: pending.sessionFile,
          cwd: pending.cwd,
          repoRoot: pending.repoRoot,
          skillName: pending.skillFileLoad.skillName,
          skillPath: pending.skillFileLoad.skillPath,
          loadSource: 'skill_file_read',
          toolCallId: event.toolCallId,
          rawInput: null,
        });
      }
    });
  });

  pi.on('session_shutdown', async () => {
    if (!db) return;
    db.close();
    db = null;
  });
}
