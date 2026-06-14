import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { relative, resolve } from "node:path";

interface PromptState {
  touchedCodePaths: Set<string>;
  startFingerprint: string | undefined;
}

interface DiffSnapshot {
  changedCodeFiles: number;
  totalChangedLines: number;
  maxSingleFileChangedLines: number;
  score: number;
  material: boolean;
  fingerprint: string;
  summary: string;
}

interface GateState {
  baselineFingerprint: string | undefined;
  lastReviewedFingerprint: string | undefined;
  lastPromptedFingerprint: string | undefined;
  reviewRequired: boolean;
  pendingSnapshot: DiffSnapshot | undefined;
  sawReviewerPass: boolean;
  sawIntentValidatorPass: boolean;
}

const CODE_PATH_RE = /\.(py|ts|tsx|mts|cts|js|jsx|mjs|cjs|sql|swift|go|rs|java|kt|scala|rb|php|c|cc|cpp|cxx|h|hpp)$/i;
const STATE_ENTRY_TYPE = "semantic-completion-gate-state";
const PROMPT_STATE_ENTRY_TYPE = "semantic-completion-gate-prompt";

function createPromptState(): PromptState {
  return { touchedCodePaths: new Set<string>(), startFingerprint: undefined };
}

let promptState = createPromptState();
let gateState: GateState = {
  baselineFingerprint: undefined,
  lastReviewedFingerprint: undefined,
  lastPromptedFingerprint: undefined,
  reviewRequired: false,
  pendingSnapshot: undefined,
  sawReviewerPass: false,
  sawIntentValidatorPass: false,
};

const REVIEWER_AGENTS = new Set([
  "architecture-reviewer",
  "complexity-reviewer",
  "correctness-reviewer",
  "duplication-reviewer",
  "ops-reviewer",
  "visual-tester",
  "yagni-reviewer",
]);

function isCodePath(path: string): boolean {
  return CODE_PATH_RE.test(path);
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function isGitRepo(cwd: string): boolean {
  try {
    git(["rev-parse", "--show-toplevel"], cwd);
    return true;
  } catch {
    return false;
  }
}

function hasHead(cwd: string): boolean {
  try {
    git(["rev-parse", "--verify", "HEAD"], cwd);
    return true;
  } catch {
    return false;
  }
}

function countFileLines(path: string): number {
  try {
    if (!existsSync(path)) return 0;
    const text = readFileSync(path, "utf8");
    if (text.length === 0) return 0;
    return text.split(/\r?\n/).length;
  } catch {
    return 0;
  }
}

function parseNumstat(output: string): Map<string, number> {
  const fileChanges = new Map<string, number>();
  for (const line of output.split("\n")) {
    if (!line.trim()) continue;
    const [addedRaw, deletedRaw, ...pathParts] = line.split("\t");
    const path = pathParts.join("\t").trim();
    if (!path || !isCodePath(path)) continue;
    const added = addedRaw === "-" ? 0 : Number.parseInt(addedRaw, 10) || 0;
    const deleted = deletedRaw === "-" ? 0 : Number.parseInt(deletedRaw, 10) || 0;
    fileChanges.set(path, added + deleted);
  }
  return fileChanges;
}

function computeScore(changedCodeFiles: number, totalChangedLines: number, maxSingleFileChangedLines: number): number {
  let score = 0;
  if (changedCodeFiles >= 2) score += 1;
  if (changedCodeFiles >= 4) score += 1;
  if (totalChangedLines >= 40) score += 1;
  if (totalChangedLines >= 120) score += 1;
  if (maxSingleFileChangedLines >= 80) score += 1;
  return score;
}

function summarize(snapshot: DiffSnapshot): string {
  return `${snapshot.changedCodeFiles} code file(s), ${snapshot.totalChangedLines} changed line(s), max single-file delta ${snapshot.maxSingleFileChangedLines}, score ${snapshot.score}`;
}

function emptySnapshot(): DiffSnapshot {
  const fingerprint = createHash("sha1").update("empty").digest("hex");
  return {
    changedCodeFiles: 0,
    totalChangedLines: 0,
    maxSingleFileChangedLines: 0,
    score: 0,
    material: false,
    fingerprint,
    summary: "0 code files, 0 changed lines, score 0",
  };
}

function computeDiffSnapshot(cwd: string): DiffSnapshot {
  if (!isGitRepo(cwd)) return emptySnapshot();

  const fileChanges = new Map<string, number>();

  try {
    if (hasHead(cwd)) {
      const tracked = git(["diff", "--numstat", "--no-renames", "HEAD", "--"], cwd);
      for (const [path, count] of parseNumstat(tracked)) fileChanges.set(path, count);
    } else {
      const staged = git(["diff", "--numstat", "--no-renames", "--cached", "--"], cwd);
      const unstaged = git(["diff", "--numstat", "--no-renames", "--"], cwd);
      for (const [path, count] of parseNumstat(staged)) fileChanges.set(path, count);
      for (const [path, count] of parseNumstat(unstaged)) fileChanges.set(path, count);
    }
  } catch {
    return emptySnapshot();
  }

  try {
    const untracked = git(["ls-files", "--others", "--exclude-standard", "--"], cwd);
    for (const relPath of untracked.split("\n").map((line) => line.trim()).filter(Boolean)) {
      if (!isCodePath(relPath)) continue;
      const absPath = resolve(cwd, relPath);
      fileChanges.set(relPath, countFileLines(absPath));
    }
  } catch {
    // ignore untracked lookup failures
  }

  const entries = [...fileChanges.entries()].sort(([a], [b]) => a.localeCompare(b));
  const changedCodeFiles = entries.length;
  const totalChangedLines = entries.reduce((sum, [, count]) => sum + count, 0);
  const maxSingleFileChangedLines = entries.reduce((max, [, count]) => Math.max(max, count), 0);
  const score = computeScore(changedCodeFiles, totalChangedLines, maxSingleFileChangedLines);
  const material = score >= 2;
  const fingerprint = createHash("sha1").update(JSON.stringify(entries)).digest("hex");
  const snapshot: DiffSnapshot = {
    changedCodeFiles,
    totalChangedLines,
    maxSingleFileChangedLines,
    score,
    material,
    fingerprint,
    summary: "",
  };
  snapshot.summary = summarize(snapshot);
  return snapshot;
}

function persistGateState(pi: ExtensionAPI): void {
  pi.appendEntry(STATE_ENTRY_TYPE, {
    baselineFingerprint: gateState.baselineFingerprint,
    lastReviewedFingerprint: gateState.lastReviewedFingerprint,
    lastPromptedFingerprint: gateState.lastPromptedFingerprint,
    reviewRequired: gateState.reviewRequired,
    pendingSnapshot: gateState.pendingSnapshot,
    sawReviewerPass: gateState.sawReviewerPass,
    sawIntentValidatorPass: gateState.sawIntentValidatorPass,
  });
}

function persistPromptSnapshot(pi: ExtensionAPI, cwd: string, snapshot: DiffSnapshot): void {
  pi.appendEntry(PROMPT_STATE_ENTRY_TYPE, {
    cwd,
    snapshot,
    at: new Date().toISOString(),
  });
}

function restoreGateState(ctx: { cwd: string; sessionManager: { getEntries(): any[] } }): void {
  const entries = ctx.sessionManager.getEntries();
  const stateEntry = [...entries].reverse().find((entry) => entry.type === "custom" && entry.customType === STATE_ENTRY_TYPE);
  if (stateEntry?.data && typeof stateEntry.data === "object") {
    gateState = {
      baselineFingerprint: typeof stateEntry.data.baselineFingerprint === "string" ? stateEntry.data.baselineFingerprint : undefined,
      lastReviewedFingerprint: typeof stateEntry.data.lastReviewedFingerprint === "string" ? stateEntry.data.lastReviewedFingerprint : undefined,
      lastPromptedFingerprint: typeof stateEntry.data.lastPromptedFingerprint === "string" ? stateEntry.data.lastPromptedFingerprint : undefined,
      reviewRequired: stateEntry.data.reviewRequired === true,
      pendingSnapshot: stateEntry.data.pendingSnapshot,
      sawReviewerPass: stateEntry.data.sawReviewerPass === true,
      sawIntentValidatorPass: stateEntry.data.sawIntentValidatorPass === true,
    };
    return;
  }

  const snapshot = computeDiffSnapshot(ctx.cwd);
  gateState = {
    baselineFingerprint: snapshot.fingerprint,
    lastReviewedFingerprint: snapshot.fingerprint,
    lastPromptedFingerprint: snapshot.fingerprint,
    reviewRequired: false,
    pendingSnapshot: undefined,
    sawReviewerPass: false,
    sawIntentValidatorPass: false,
  };
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    restoreGateState(ctx);
    persistGateState(pi);
  });

  pi.on("agent_start", async () => {
    promptState = createPromptState();
    promptState.startFingerprint = computeDiffSnapshot(process.cwd()).fingerprint;
  });

  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "goal_complete") {
      if (!gateState.reviewRequired || !gateState.pendingSnapshot) return undefined;
      return {
        block: true,
        reason: `Semantic completion gate: material code changes are still unreviewed (${gateState.pendingSnapshot.summary}). Before claiming completion, run a reviewer pass consistent with review-with-subagents and include intent-validator.`,
      };
    }

    if (event.toolName !== "subagent") return undefined;
    const input = event.input as { agent?: string; name?: string };
    const agentName = input.agent ?? input.name;
    if (!agentName) return undefined;

    if (REVIEWER_AGENTS.has(agentName)) {
      gateState.sawReviewerPass = true;
      persistGateState(pi);
      return undefined;
    }

    if (agentName !== "intent-validator") return undefined;

    const snapshot = computeDiffSnapshot(ctx.cwd);
    gateState.sawIntentValidatorPass = true;
    if (gateState.sawReviewerPass) {
      gateState.lastReviewedFingerprint = snapshot.fingerprint;
      gateState.lastPromptedFingerprint = snapshot.fingerprint;
      gateState.reviewRequired = false;
      gateState.pendingSnapshot = undefined;
      gateState.sawReviewerPass = false;
      gateState.sawIntentValidatorPass = false;
    }
    persistGateState(pi);
    return undefined;
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError) return;
    if (event.toolName !== "edit" && event.toolName !== "write") return;
    const path = (event.input as { path?: string }).path;
    if (typeof path !== "string") return;
    const resolved = resolve(ctx.cwd, path);
    const relPath = relative(ctx.cwd, resolved);
    if (!isCodePath(relPath)) return;
    promptState.touchedCodePaths.add(relPath);
  });

  pi.on("before_agent_start", async (event) => {
    if (!gateState.reviewRequired || !gateState.pendingSnapshot) return undefined;
    return {
      systemPrompt:
        event.systemPrompt +
        `\n\nCritical review gate: material code changes are currently unreviewed (${gateState.pendingSnapshot.summary}). Before claiming completion, use the review-with-subagents skill and include intent-validator. Do not claim the work is done until that review pass has happened.`,
    };
  });

  pi.on("agent_end", async (_event, ctx) => {
    const snapshot = computeDiffSnapshot(ctx.cwd);
    const promptChangedDiff = snapshot.fingerprint !== promptState.startFingerprint;
    if (!promptChangedDiff && promptState.touchedCodePaths.size === 0) return;
    persistPromptSnapshot(pi, ctx.cwd, snapshot);

    if (!snapshot.material || snapshot.fingerprint === gateState.lastReviewedFingerprint) {
      if (!snapshot.material) {
        gateState.lastPromptedFingerprint = snapshot.fingerprint;
        gateState.reviewRequired = false;
        gateState.pendingSnapshot = undefined;
        persistGateState(pi);
      }
      return;
    }

    gateState.reviewRequired = true;
    gateState.pendingSnapshot = snapshot;
    gateState.sawReviewerPass = false;
    gateState.sawIntentValidatorPass = false;
    if (!gateState.baselineFingerprint) gateState.baselineFingerprint = snapshot.fingerprint;
    persistGateState(pi);

    if (gateState.lastPromptedFingerprint === snapshot.fingerprint) {
      return;
    }

    gateState.lastPromptedFingerprint = snapshot.fingerprint;
    persistGateState(pi);
    pi.sendUserMessage(
      `Material work detected (${snapshot.summary}). Before claiming completion, use the review-with-subagents skill, run at least one reviewer subagent appropriate to the change, include intent-validator, then reassess whether completion is honest.`,
    );

  });
}
