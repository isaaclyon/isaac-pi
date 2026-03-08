import { mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chooseLoopTrigger, updateMetricsFromJsonLine, type RalphLoopMetrics } from "./runtime.js";
import { buildPiCommand, buildSessionName, startDetachedSession, stopSession } from "./tmux.js";
import type { RalphRunConfig } from "./types.js";
import type { RalphLoopExecutionResult } from "./supervisor.js";

type ReadOutputResult = {
	lines: string[];
	nextLine: number;
};

export type LoopExecutorDeps = {
	startSession: (input: { sessionName: string; command: string; cwd?: string }) => Promise<void>;
	hasSession: (sessionName: string) => Promise<boolean>;
	stopSession: (sessionName: string) => Promise<void>;
	readOutput: (path: string, fromLine: number) => Promise<ReadOutputResult>;
	wait: (ms: number) => Promise<void>;
};

const POLL_MS = 250;

async function hasTmuxSession(sessionName: string): Promise<boolean> {
	const { spawn } = await import("node:child_process");
	return new Promise((resolveValue) => {
		const proc = spawn("tmux", ["has-session", "-t", sessionName], {
			shell: false,
			stdio: ["ignore", "ignore", "ignore"],
		});
		proc.on("close", (code) => resolveValue(code === 0));
		proc.on("error", () => resolveValue(false));
	});
}

async function readOutputLines(path: string, fromLine: number): Promise<ReadOutputResult> {
	let raw = "";
	try {
		raw = readFileSync(path, "utf8");
	} catch {
		return { lines: [], nextLine: fromLine };
	}

	const rawLines = raw.split("\n");
	if (raw.endsWith("\n")) {
		rawLines.pop();
	}

	const start = Math.max(0, fromLine);
	const chunk = rawLines.slice(start);
	return {
		lines: chunk.filter((line) => line.trim().length > 0),
		nextLine: rawLines.length,
	};
}

function extractChildFailure(line: string): string | null {
	let parsed: any;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}

	if (parsed?.type !== "message_end" || !parsed.message || parsed.message.role !== "assistant") {
		return null;
	}

	const stopReason = typeof parsed.message.stopReason === "string" ? parsed.message.stopReason : undefined;
	if (stopReason === "error" || stopReason === "aborted") {
		if (typeof parsed.message.errorMessage === "string" && parsed.message.errorMessage.trim()) {
			return parsed.message.errorMessage.trim();
		}
		return `assistant stopReason=${stopReason}`;
	}

	if (typeof parsed.message.errorMessage === "string" && parsed.message.errorMessage.trim()) {
		return parsed.message.errorMessage.trim();
	}

	return null;
}

const defaultDeps: LoopExecutorDeps = {
	startSession: async ({ sessionName, command, cwd }) => {
		await startDetachedSession({ sessionName, command, cwd });
	},
	hasSession: hasTmuxSession,
	stopSession,
	readOutput: readOutputLines,
	wait: (ms) => new Promise((resolveValue) => setTimeout(resolveValue, ms)),
};

export async function executeLoopWithTmux(input: {
	runId: string;
	loopNumber: number;
	config: RalphRunConfig;
	previousCheckpoint: string | null;
	modelContextWindowTokens: number;
	signal?: AbortSignal;
	deps?: LoopExecutorDeps;
}): Promise<RalphLoopExecutionResult> {
	const deps = input.deps ?? defaultDeps;
	const runDir = resolve(input.config.runner.cwd, ".pi", "ralph-loop", "runs", input.runId);
	mkdirSync(runDir, { recursive: true });
	const outputPath = join(runDir, `loop-${String(input.loopNumber).padStart(2, "0")}.jsonl`);
	const sessionName = buildSessionName({
		prefix: input.config.runner.tmuxSessionPrefix,
		runId: input.runId,
		loopNumber: input.loopNumber,
	});

	const appendSystemPrompt = input.previousCheckpoint
		? `Continue from this prior checkpoint JSON:\n${input.previousCheckpoint}`
		: undefined;
	const command = buildPiCommand({
		task: input.config.task,
		model: input.config.runner.model,
		tools: input.config.runner.tools,
		appendSystemPrompt,
		outputPath,
	});

	await deps.startSession({ sessionName, command, cwd: input.config.runner.cwd });

	let fromLine = 0;
	let metrics: RalphLoopMetrics = { assistantTurns: 0, toolCalls: 0, contextTokens: 0 };
	let triggerReason = "session_exit";
	let childFailure: string | null = null;
	let aborted = input.signal?.aborted === true;
	let stopRequested = false;

	const requestStop = async () => {
		if (stopRequested) return;
		stopRequested = true;
		await deps.stopSession(sessionName);
	};

	const abortHandler = () => {
		aborted = true;
		void requestStop();
	};
	input.signal?.addEventListener("abort", abortHandler);

	while (!aborted && await deps.hasSession(sessionName)) {
		const output = await deps.readOutput(outputPath, fromLine);
		fromLine = output.nextLine;

		for (const line of output.lines) {
			metrics = updateMetricsFromJsonLine(metrics, line);

			const failure = extractChildFailure(line);
			if (failure) {
				childFailure = failure;
				triggerReason = "child_execution_failed";
				await requestStop();
				break;
			}

			const trigger = chooseLoopTrigger(metrics, input.config.budget, input.modelContextWindowTokens);
			if (trigger) {
				triggerReason = trigger;
				await requestStop();
				break;
			}
		}

		if (triggerReason !== "session_exit") {
			break;
		}
		await deps.wait(POLL_MS);
	}

	input.signal?.removeEventListener("abort", abortHandler);

	if (aborted) {
		await requestStop();
		return {
			state: "stopped",
			triggerReason: "operator_stop",
			summary: `Loop ${input.loopNumber} stopped by operator.`,
			artifacts: {
				outputPath,
				sessionName,
				metrics,
			},
			nextPrompt: `Loop ${input.loopNumber} was stopped by operator. Resume from ${outputPath}.`,
		};
	}

	if (childFailure) {
		return {
			state: "failed",
			triggerReason,
			summary: `Loop ${input.loopNumber} failed: ${childFailure}`,
			artifacts: {
				outputPath,
				sessionName,
				metrics,
				childFailure,
			},
			nextPrompt: `Child execution failed in loop ${input.loopNumber}. Fix the failure and retry from ${outputPath}.`,
		};
	}

	return {
		state: "completed",
		triggerReason,
		summary: `Loop ${input.loopNumber} completed (assistantTurns=${metrics.assistantTurns}, toolCalls=${metrics.toolCalls}, contextTokens=${metrics.contextTokens}).`,
		artifacts: {
			outputPath,
			sessionName,
			metrics,
		},
		nextPrompt: `Continue the task from loop ${input.loopNumber} artifacts at ${outputPath}.`,
	};
}

export const readOutputLinesForTests = readOutputLines;
