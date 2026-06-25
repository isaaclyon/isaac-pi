import type { ExtensionAPI, ToolInfo } from "@earendil-works/pi-coding-agent";
import { openUsageAnalyticsDb, recordSkillInvocation, recordToolExecution } from "../src/db.mjs";
import { extractExplicitSkillInvocations, resolveRepoRootFromPath } from "../src/repo.mjs";

interface PendingToolExecution {
  startedAt: number;
  cwd: string;
  repoRoot: string | null;
  sessionFile: string | null;
  toolName: string;
  toolPath: string | null;
  toolSource: 'extension' | 'non_extension';
}

function classifyTool(tool: ToolInfo | undefined): Pick<PendingToolExecution, 'toolPath' | 'toolSource'> {
  const toolPath = tool?.sourceInfo.path ?? null;
  const source = tool?.sourceInfo.source;
  const toolSource = source && source !== 'builtin' && source !== 'sdk' ? 'extension' : 'non_extension';
  return { toolPath, toolSource };
}

export default function usageTracker(pi: ExtensionAPI) {
  const pendingExecutions = new Map<string, PendingToolExecution>();
  const repoRootCache = new Map<string, string | null>();
  let toolsByName = new Map<string, ToolInfo>();
  let db = null;

  function logDbError(error: unknown) {
    console.error('[usage-analytics] collector write failed:', error instanceof Error ? error.message : String(error));
  }

  function getDb() {
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

  refreshTools();

  pi.on('session_start', async () => {
    refreshTools();
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
    });
  });

  pi.on('session_shutdown', async () => {
    if (!db) return;
    db.close();
    db = null;
  });
}
