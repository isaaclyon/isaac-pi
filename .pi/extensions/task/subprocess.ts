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
import { MAX_TIMEOUT_MS } from "./types.js";
import type {
	BuiltInToolName,
	ProviderModel,
	SingleResult,
	TaskFailureContext,
	TaskThinking,
	TaskWorkItem,
	UsageStats,
} from "./types.js";

// ---------------------------------------------------------------------------
// Config and helpers
// ---------------------------------------------------------------------------

const SUBPROCESS_COMMAND = "pi";

function formatTimestamp(date: Date): string {
	return date.toISOString();
}

function resolveThinking(
	thinking: TaskThinking,
	inherited: ThinkingLevel,
): ThinkingLevel {
	return thinking === "inherit" ? inherited : thinking;
}

function isSensitiveKey(key: string): boolean {
	return /token|api.?key|secret|password|auth|cookie/i.test(key);
}

function sanitizeArgumentValue(value: string): string {
	if (!value) return value;
	if (value.length <= 512) return value;
	return `${value.slice(0, 24)}...${value.slice(-8)} (truncated)`;
}

function sanitizeCommandArgs(args: string[]): string[] {
	return args.map((arg, index) => {
		const isPromptArgument = index === args.length - 1;
		if (isPromptArgument) {
			return `[prompt redacted (${arg.length} chars)]`;
		}
		if (!arg.startsWith("--") && !arg.includes("=")) return sanitizeArgumentValue(arg);
		if (!arg.includes("=")) return sanitizeArgumentValue(arg);
		const [key, val] = arg.split("=", 2);
		if (isSensitiveKey(key)) return `${key}=***`;
		return `${key}=${sanitizeArgumentValue(val ?? "")}`;
	});
}

function sanitizeToolArguments(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((entry) => sanitizeToolArguments(entry));
	}
	if (isRecord(value)) {
		const out: Record<string, unknown> = {};
		for (const [key, raw] of Object.entries(value)) {
			if (isSensitiveKey(key)) {
				out[key] = "***";
				continue;
			}
			out[key] = sanitizeToolArguments(raw);
		}
		return out;
	}
	if (typeof value === "string") return sanitizeArgumentValue(value);
	return value;
}

function sanitizeToolCalls(toolCalls: TaskFailureContext["toolCalls"]): TaskFailureContext["toolCalls"] {
	if (!toolCalls) return [];
	return toolCalls.map((call) => ({
		...call,
		arguments: sanitizeToolArguments(call.arguments),
	}));
}

function createFailureContext(args: {
	command: string;
	subprocessArgs: string[];
	cwd: string;
	startedAt: Date;
	endedAt: Date;
	durationMs: number;
	exitCode: number;
	source: TaskFailureContext["source"];
	error?: Error;
	stopReason?: string;
	stdout: string;
	stderr: string;
	toolCalls?: TaskFailureContext["toolCalls"];
}): TaskFailureContext {
	return {
		command: args.command,
		args: sanitizeCommandArgs(args.subprocessArgs),
		cwd: args.cwd,
		startedAt: formatTimestamp(args.startedAt),
		endedAt: formatTimestamp(args.endedAt),
		durationMs: args.durationMs,
		source: args.source,
		exitCode: args.exitCode,
		stopReason: args.stopReason,
		errorName: args.error?.name,
		errorMessage: args.error?.message,
		errorStack: args.error?.stack,
		stdout: args.stdout,
		stderr: args.stderr,
		toolCalls: args.toolCalls,
	};
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

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

function collectToolCalls(result: SingleResult, message: Message): void {
	if (!Array.isArray((message as Message & { content?: unknown }).content)) return;
	for (const rawPart of (message as Message & { content: unknown }).content) {
		if (!isRecord(rawPart)) continue;
		if (rawPart.type !== "toolCall") continue;
		const name = typeof rawPart.name === "string" ? rawPart.name : "unknown";
		result.toolCalls ??= [];
		result.toolCalls.push({
			name,
			arguments: sanitizeToolArguments(rawPart.arguments),
			timestamp: formatTimestamp(new Date()),
		});
	}
}

function extractToolErrorFromMessage(message: unknown): { message: string; isError: boolean } | undefined {
	if (!isRecord(message)) return undefined;
	if (message.isError !== true) return undefined;
	if (typeof message.errorMessage === "string" && message.errorMessage) {
		return { message: message.errorMessage, isError: true };
	}
	if (typeof message.content === "string") {
		return { message: message.content, isError: true };
	}
	if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (!isRecord(part)) continue;
			if (typeof part.text === "string") return { message: part.text, isError: true };
			if (typeof part.message === "string") return { message: part.message, isError: true };
		}
	}
	return { message: "tool reported an error", isError: true };
}

function extractToolErrorFromEvent(event: unknown): { message: string; isError: boolean } | undefined {
	if (!isRecord(event)) return undefined;

	const messageError = extractToolErrorFromMessage(event.message);
	if (messageError) return messageError;

	const nested = (event as { toolResults?: unknown[] }).toolResults;
	if (Array.isArray(nested)) {
		for (const item of nested) {
			const toolError = extractToolErrorFromMessage(item);
			if (toolError) return toolError;
		}
	}

	return undefined;
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
	if (message.role === "assistant") {
		applyAssistantUsage(result, message);
		collectToolCalls(result, message);
		if (!result.model && message.model) result.model = message.model;
		if (message.stopReason && result.stopReason !== "error") {
			result.stopReason = message.stopReason;
		}
		if (message.errorMessage) result.errorMessage = message.errorMessage;
	}
}

function parseFailureSource(result: SingleResult, timedOut: boolean, aborted: boolean): TaskFailureContext["source"] {
	if (timedOut) return "timeout";
	if (aborted) return "aborted";
	if (result.stopReason === "error") return "tool_error";
	if (result.stopReason === "spawn") return "spawn_error";
	if (result.exitCode > 0) return "exit";
	return "unknown";
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
		rawStdout: "",
		usage: emptyUsage(),
		model,
		thinking,
		toolCalls: [],
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
		rawStdout: "",
		usage: emptyUsage(),
		model: options.modelLabel,
		thinking: options.thinking,
		toolCalls: [],
	};

	const emit = () => options.onResultUpdate?.(result);

	const args = [...options.subprocessArgs, options.subprocessPrompt];
	const startedAt = new Date();
	result.startedAt = formatTimestamp(startedAt);

	const exitCode = await new Promise<number>((resolve) => {
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		let settled = false;
		let timedOut = false;
		let finalBuffer = "";

		const proc = spawn(SUBPROCESS_COMMAND, args, {
			cwd: options.cwd,
			shell: false,
			stdio: ["pipe", "pipe", "pipe"],
		});

		const abortState = attachAbortSignal(proc, options.signal);

		const finalize = (code: number, opts?: { error?: Error; forcedSource?: TaskFailureContext["source"] }) => {
			if (settled) return;
			settled = true;
			if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);

			if (finalBuffer.trim()) {
				for (const rawLine of finalBuffer.split("\n")) {
					if (!rawLine.trim()) continue;
					processLine(rawLine);
				}
			}

			const endedAt = new Date();
			const durationMs = endedAt.getTime() - startedAt.getTime();
			result.endedAt = formatTimestamp(endedAt);
			result.durationMs = durationMs;
			result.exitCode = code;
			result.rawStdout = result.rawStdout ?? "";

			if (timedOut) {
				result.stopReason = "timeout";
				result.errorMessage = `Task timed out after ${options.timeout}s`;
			} else if (abortState.isAborted()) {
				result.stopReason = "aborted";
			} else if (opts?.error) {
				result.stopReason = "error";
				result.errorMessage = opts.error.message;
			}

			const source = opts?.forcedSource ?? parseFailureSource(result, timedOut, abortState.isAborted());
			if (code > 0 || result.stopReason === "timeout" || result.stopReason === "aborted" || result.stopReason === "error") {
				const failure = createFailureContext({
					command: SUBPROCESS_COMMAND,
					subprocessArgs: args,
					cwd: options.cwd,
					startedAt,
					endedAt,
					durationMs,
					exitCode: code,
					source,
					error: opts?.error,
					stopReason: result.stopReason,
					stdout: result.rawStdout ?? "",
					stderr: result.stderr ?? "",
					toolCalls: sanitizeToolCalls(result.toolCalls),
				});
				result.failure = failure;
				if (!result.errorMessage && code > 0) {
					result.errorMessage = `Subprocess exited with code ${code}.`;
				}
			}

			emit();
			resolve(code);
		};

		proc.stdin.end();

		if (options.timeout !== undefined && options.timeout > 0) {
			const timeoutMs = Math.min(
				MAX_TIMEOUT_MS,
				Math.max(1, Math.ceil(options.timeout * 1000)),
			);
			timeoutHandle = setTimeout(() => {
				timedOut = true;
				proc.kill("SIGTERM");
				setTimeout(() => {
					if (!proc.killed) proc.kill("SIGKILL");
				}, 5000);
			}, timeoutMs);
		}

		const processLine = (line: string) => {
			const event = parseJsonLine(line);
			if (!event) return;
			const typeStr = typeof event.type === "string" ? event.type : "";

			const toolError = extractToolErrorFromEvent(event);
			if (toolError) {
				result.stopReason = "error";
				if (!result.errorMessage) {
					result.errorMessage = toolError.message;
				}
			}

			if (
				(typeStr === "message_end" || typeStr === "tool_result_end") &&
				isMessage(event.message)
			) {
				handleEventMessage(result, event.message);
				emit();
			}
		};

		proc.stdout.on("data", (data: { toString(): string }) => {
			const chunk = data.toString();
			result.rawStdout = (result.rawStdout ?? "") + chunk;
			finalBuffer += chunk;
			const lines = finalBuffer.split("\n");
			finalBuffer = lines.pop() ?? "";
			for (const line of lines) {
				processLine(line);
			}
		});

		proc.stderr.on("data", (data: { toString(): string }) => {
			result.stderr += data.toString();
		});

		proc.on("close", (code: number | null) => {
			if (timedOut) {
				finalize(code ?? 0);
				return;
			}
			const exitCode = code ?? 0;
			finalize(exitCode);
		});

		proc.on("error", (error: Error) => {
			finalize(1, { error, forcedSource: "spawn_error" });
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
