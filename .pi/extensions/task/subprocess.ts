/**
 * Subprocess spawning and streaming for the task tool.
 *
 * Each task runs as `pi --mode json -p --no-session --no-extensions ...`
 * and streams JSON events back on stdout.
 */

import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, Message } from "@mariozechner/pi-ai";
import { isRecord } from "./params.js";
import type {
	BuiltInToolName,
	ProviderModel,
	SingleResult,
	TaskThinking,
	TaskWorkItem,
	UsageStats,
} from "./types.js";

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

function resolveThinking(
	thinking: TaskThinking,
	inherited: ThinkingLevel,
): ThinkingLevel {
	return thinking === "inherit" ? inherited : thinking;
}

function buildSubprocessArgs(options: {
	model: ProviderModel | undefined;
	thinkingLevel: ThinkingLevel;
	builtInTools: BuiltInToolName[];
}): string[] {
	const args: string[] = [
		"--mode",
		"json",
		"-p",
		"--no-session",
		"--no-extensions",
	];

	if (options.model) {
		args.push("--provider", options.model.provider);
		args.push("--model", options.model.modelId);
	}

	args.push("--thinking", options.thinkingLevel);

	if (options.builtInTools.length === 0) {
		args.push("--no-tools");
	} else {
		args.push("--tools", options.builtInTools.join(","));
	}

	return args;
}

// ---------------------------------------------------------------------------
// Public config resolver
// ---------------------------------------------------------------------------

import { resolveModel } from "./params.js";

export interface ResolvedConfig {
	thinkingLevel: ThinkingLevel;
	subprocessArgs: string[];
	modelLabel: string | undefined;
	/** Resolved timeout in seconds (item-level overrides top-level default). */
	timeout: number | undefined;
}

export function resolveTaskConfig(options: {
	item: TaskWorkItem;
	defaultModel: string | undefined;
	defaultThinking: TaskThinking;
	defaultTimeout: number | undefined;
	inheritedThinking: ThinkingLevel;
	ctxModel: { provider: string; id: string } | undefined;
	builtInTools: BuiltInToolName[];
}):
	| { ok: true } & ResolvedConfig
	| { ok: false; error: string } {
	const modelOverride = options.item.model ?? options.defaultModel;
	const modelRes = resolveModel(modelOverride, options.ctxModel);
	if (!modelRes.ok) return modelRes;

	const thinkingLevel = resolveThinking(
		options.item.thinking ?? options.defaultThinking,
		options.inheritedThinking,
	);

	const subprocessArgs = buildSubprocessArgs({
		model: modelRes.model,
		thinkingLevel,
		builtInTools: options.builtInTools,
	});

	return {
		ok: true,
		thinkingLevel,
		subprocessArgs,
		modelLabel: modelRes.model?.label,
		timeout: options.item.timeout ?? options.defaultTimeout,
	};
}

// ---------------------------------------------------------------------------
// JSON event parsing
// ---------------------------------------------------------------------------

function parseJsonLine(line: string): Record<string, unknown> | undefined {
	if (!line.trim()) return undefined;
	try {
		const parsed = JSON.parse(line) as unknown;
		return isRecord(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

function isMessage(value: unknown): value is Message {
	if (!isRecord(value)) return false;
	const role = value.role;
	return role === "assistant" || role === "user" || role === "toolResult";
}

function applyAssistantUsage(
	result: SingleResult,
	message: AssistantMessage,
): void {
	result.usage.turns += 1;
	const usage = message.usage;
	result.usage.input += usage.input ?? 0;
	result.usage.output += usage.output ?? 0;
	result.usage.cacheRead += usage.cacheRead ?? 0;
	result.usage.cacheWrite += usage.cacheWrite ?? 0;
	result.usage.cost += usage.cost?.total ?? 0;
	result.usage.contextTokens = usage.totalTokens ?? 0;
}

function handleEventMessage(result: SingleResult, message: Message): void {
	result.messages.push(message);
	if (message.role !== "assistant") return;
	applyAssistantUsage(result, message);
	if (!result.model && message.model) result.model = message.model;
	if (message.stopReason) result.stopReason = message.stopReason;
	if (message.errorMessage) result.errorMessage = message.errorMessage;
}

// ---------------------------------------------------------------------------
// Abort handling
// ---------------------------------------------------------------------------

function attachAbortSignal(
	proc: ChildProcessWithoutNullStreams,
	signal: AbortSignal | undefined,
): { isAborted: () => boolean } {
	let aborted = false;
	if (!signal) return { isAborted: () => aborted };

	const kill = () => {
		aborted = true;
		proc.kill("SIGTERM");
		setTimeout(() => {
			if (!proc.killed) proc.kill("SIGKILL");
		}, 5000);
	};

	if (signal.aborted) kill();
	else signal.addEventListener("abort", kill, { once: true });

	return { isAborted: () => aborted };
}

// ---------------------------------------------------------------------------
// Result factory
// ---------------------------------------------------------------------------

export function emptyUsage(): UsageStats {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
}

export function placeholderResult(
	item: TaskWorkItem,
	index: number | undefined,
	thinking?: ThinkingLevel,
	model?: string,
	exitCode = -1,
): SingleResult {
	return {
		name: item.name,
		prompt: item.prompt,
		skill: item.skill,
		index,
		exitCode,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		model,
		thinking,
	};
}

// ---------------------------------------------------------------------------
// Single task execution
// ---------------------------------------------------------------------------

export interface RunTaskOptions {
	cwd: string;
	item: TaskWorkItem;
	subprocessPrompt: string;
	index: number | undefined;
	subprocessArgs: string[];
	modelLabel: string | undefined;
	thinking: ThinkingLevel;
	/** Timeout in seconds. Process is sent SIGTERM then SIGKILL after a grace period. */
	timeout: number | undefined;
	signal: AbortSignal | undefined;
	onResultUpdate?: (result: SingleResult) => void;
}

export async function runSingleTask(
	options: RunTaskOptions,
): Promise<SingleResult> {
	const result: SingleResult = {
		name: options.item.name,
		prompt: options.item.prompt,
		skill: options.item.skill,
		index: options.index,
		exitCode: -1,
		messages: [],
		stderr: "",
		usage: emptyUsage(),
		model: options.modelLabel,
		thinking: options.thinking,
	};

	const emit = () => options.onResultUpdate?.(result);

	const args = [...options.subprocessArgs, options.subprocessPrompt];

	const exitCode = await new Promise<number>((resolve) => {
		const proc = spawn("pi", args, {
			cwd: options.cwd,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});

		proc.stdin.end();

		const abortState = attachAbortSignal(proc, options.signal);

		let timedOut = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		if (options.timeout !== undefined && options.timeout > 0) {
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			}, options.timeout * 1000);
		}

		let buffer = "";
		const processLine = (line: string) => {
			const event = parseJsonLine(line);
			if (!event) return;
			const typeStr =
				typeof event.type === "string" ? event.type : "";
			if (
				(typeStr === "message_end" || typeStr === "tool_result_end") &&
				isMessage(event.message)
			) {
				handleEventMessage(result, event.message);
				emit();
			}
		};

		proc.stdout.on("data", (data: { toString(): string }) => {
			buffer += data.toString();
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) processLine(line);
		});

		proc.stderr.on("data", (data: { toString(): string }) => {
			result.stderr += data.toString();
		});

		proc.on("close", (code: number | null) => {
			if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
			if (buffer.trim()) processLine(buffer);
			result.exitCode = code ?? 0;
			if (timedOut) {
				result.stopReason = "timeout";
				result.errorMessage = `Task timed out after ${options.timeout}s`;
			} else if (abortState.isAborted()) {
				result.stopReason = "aborted";
			}
			resolve(code ?? 0);
		});

		proc.on("error", () => {
			if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
			result.exitCode = 1;
			resolve(1);
		});
	});

	result.exitCode = exitCode;
	return result;
}

// ---------------------------------------------------------------------------
// Concurrency limiter
// ---------------------------------------------------------------------------

export async function mapWithConcurrency<TIn, TOut>(
	items: TIn[],
	concurrency: number,
	fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
	if (items.length === 0) return [];
	const limit = Math.max(1, Math.min(concurrency, items.length));
	const results: TOut[] = new Array(items.length);
	let nextIndex = 0;

	const worker = async (): Promise<void> => {
		const current = nextIndex;
		nextIndex += 1;
		if (current >= items.length) return;
		results[current] = await fn(items[current]!, current);
		await worker();
	};

	await Promise.all(new Array(limit).fill(null).map(() => worker()));
	return results;
}
