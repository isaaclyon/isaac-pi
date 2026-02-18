/**
 * Execution logic for single, chain, and parallel task modes.
 */

import path from "node:path";
import type { AgentToolResult, AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import { buildSubprocessPrompt, type SkillState } from "./skills.js";
import {
	mapWithConcurrency,
	placeholderResult,
	resolveTaskConfig,
	runSingleTask,
	type ResolvedConfig,
} from "./subprocess.js";
import { formatToolCounts, getFinalOutput, getTaskErrorText, isTaskError2 } from "./render.js";
import type {
	BuiltInToolName,
	NormalizedParams,
	SingleResult,
	TaskThinking,
	TaskToolDetails,
	TaskWorkItem,
} from "./types.js";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILL_LIST_LIMIT = 30;
const CONCURRENCY = 4;

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface ExecuteContext {
	cwd: string;
	ctxModel: { provider: string; id: string } | undefined;
	inheritedThinking: ThinkingLevel;
	builtInTools: BuiltInToolName[];
	signal: AbortSignal | undefined;
	onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined;
}

interface PreparedExecution {
	task: { item: TaskWorkItem; subprocessPrompt: string };
	config: ResolvedConfig;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeDetails(
	mode: "single" | "parallel" | "chain",
	results: SingleResult[],
	modelOverride?: string,
): TaskToolDetails {
	return { mode, modelOverride, results };
}

function errorResult(
	text: string,
	mode: "single" | "parallel" | "chain" = "single",
): AgentToolResult<TaskToolDetails> {
	return {
		content: [{ type: "text", text }],
		details: makeDetails(mode, []),
	};
}

function resolveItemCwd(baseCwd: string, item: TaskWorkItem): string {
	return item.cwd ? path.resolve(baseCwd, item.cwd) : baseCwd;
}

function prepareExecutions(
	items: TaskWorkItem[],
	state: SkillState,
	defaultModel: string | undefined,
	defaultThinking: TaskThinking,
	defaultTimeout: number | undefined,
	ectx: ExecuteContext,
): { ok: true; executions: PreparedExecution[] } | { ok: false; error: string } {
	const executions: PreparedExecution[] = [];
	for (const item of items) {
		const prompt = buildSubprocessPrompt(item, state, SKILL_LIST_LIMIT);
		if (!prompt.ok) return prompt;

		const config = resolveTaskConfig({
			item,
			defaultModel,
			defaultThinking,
			defaultTimeout,
			inheritedThinking: ectx.inheritedThinking,
			ctxModel: ectx.ctxModel,
			builtInTools: ectx.builtInTools,
		});
		if (!config.ok) return config;

		executions.push({
			task: { item, subprocessPrompt: prompt.prompt },
			config: {
				thinkingLevel: config.thinkingLevel,
				subprocessArgs: config.subprocessArgs,
				modelLabel: config.modelLabel,
				timeout: config.timeout,
			},
		});
	}
	return { ok: true, executions };
}

function buildChainPrompt(
	prompt: string,
	previousOutput: string,
	completedOutputs: string[],
): string {
	let result = prompt.replace(/\{previous\}/g, previousOutput);
	// Replace {step1}, {step2}, etc. with outputs from completed steps (1-indexed)
	result = result.replace(/\{step(\d+)\}/g, (_match, num: string) => {
		const index = parseInt(num, 10) - 1; // convert 1-indexed to 0-indexed
		if (index >= 0 && index < completedOutputs.length) {
			return completedOutputs[index]!;
		}
		return _match; // leave unreplaceable references as-is
	});
	return result;
}

// ---------------------------------------------------------------------------
// Single
// ---------------------------------------------------------------------------

export async function executeSingle(
	params: NormalizedParams,
	state: SkillState,
	ectx: ExecuteContext,
): Promise<AgentToolResult<TaskToolDetails>> {
	const prepared = prepareExecutions(
		params.items,
		state,
		params.model,
		params.thinking,
		params.timeout,
		ectx,
	);
	if (!prepared.ok) return errorResult(prepared.error);

	const exec = prepared.executions[0]!;
	const initial = placeholderResult(
		exec.task.item,
		undefined,
		exec.config.thinkingLevel,
		exec.config.modelLabel,
	);

	const emitUpdate = (r: SingleResult) => {
		ectx.onUpdate?.({
			content: [{ type: "text", text: getFinalOutput(r.messages) || "(running...)" }],
			details: makeDetails("single", [r]),
		});
	};
	emitUpdate(initial);

	const result = await runSingleTask({
		cwd: resolveItemCwd(ectx.cwd, exec.task.item),
		item: exec.task.item,
		subprocessPrompt: exec.task.subprocessPrompt,
		index: undefined,
		subprocessArgs: exec.config.subprocessArgs,
		modelLabel: exec.config.modelLabel,
		thinking: exec.config.thinkingLevel,
		timeout: exec.config.timeout,
		signal: ectx.signal,
		onResultUpdate: emitUpdate,
	});

	if (isTaskError2(result)) {
		return {
			content: [{ type: "text", text: `Task failed: ${getTaskErrorText(result)}` }],
			details: makeDetails("single", [result]),
		};
	}

	return {
		content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
		details: makeDetails("single", [result]),
	};
}

// ---------------------------------------------------------------------------
// Chain
// ---------------------------------------------------------------------------

export async function executeChain(
	params: NormalizedParams,
	state: SkillState,
	ectx: ExecuteContext,
): Promise<AgentToolResult<TaskToolDetails>> {
	const { items, model, thinking } = params;
	const completedOutputs: string[] = [];
	const results: SingleResult[] = items.map((item, i) =>
		placeholderResult(
			{ ...item, prompt: buildChainPrompt(item.prompt, "…", []) },
			i + 1,
			undefined,
			undefined,
			-2,
		),
	);
	let previousOutput = "";

	for (let i = 0; i < items.length; i++) {
		const item = items[i]!;
		const prompt = buildChainPrompt(item.prompt, previousOutput, completedOutputs);
		const stepItem = { ...item, prompt };

		const config = resolveTaskConfig({
			item,
			defaultModel: model,
			defaultThinking: thinking,
			defaultTimeout: params.timeout,
			inheritedThinking: ectx.inheritedThinking,
			ctxModel: ectx.ctxModel,
			builtInTools: ectx.builtInTools,
		});
		if (!config.ok) {
			return {
				content: [{ type: "text", text: config.error }],
				details: makeDetails("chain", [...results]),
			};
		}

		const subPrompt = buildSubprocessPrompt(stepItem, state, SKILL_LIST_LIMIT);
		if (!subPrompt.ok) {
			return {
				content: [{ type: "text", text: subPrompt.error }],
				details: makeDetails("chain", [...results]),
			};
		}

		results[i] = placeholderResult(stepItem, i + 1, config.thinkingLevel, config.modelLabel);
		ectx.onUpdate?.({
			content: [{ type: "text", text: "(running...)" }],
			details: makeDetails("chain", [...results]),
		});

		const chainUpdate = ectx.onUpdate
			? (partial: SingleResult) => {
					results[i] = partial;
					ectx.onUpdate!({
						content: [{ type: "text", text: getFinalOutput(partial.messages) || "(running...)" }],
						details: makeDetails("chain", [...results]),
					});
				}
			: undefined;

		const result = await runSingleTask({
			cwd: resolveItemCwd(ectx.cwd, item),
			item: stepItem,
			subprocessPrompt: subPrompt.prompt,
			index: i + 1,
			subprocessArgs: config.subprocessArgs,
			modelLabel: config.modelLabel,
			thinking: config.thinkingLevel,
			timeout: config.timeout,
			signal: ectx.signal,
			onResultUpdate: chainUpdate,
		});

		results[i] = result;
		ectx.onUpdate?.({
			content: [{ type: "text", text: getFinalOutput(result.messages) || "(no output)" }],
			details: makeDetails("chain", [...results]),
		});

		if (isTaskError2(result)) {
			return {
				content: [{ type: "text", text: `Chain stopped at step ${i + 1}: ${getTaskErrorText(result)}` }],
				details: makeDetails("chain", [...results]),
			};
		}

		previousOutput = getFinalOutput(result.messages);
		completedOutputs.push(previousOutput);
	}

	const last = results[results.length - 1]!;
	return {
		content: [{ type: "text", text: getFinalOutput(last.messages) || "(no output)" }],
		details: makeDetails("chain", [...results]),
	};
}

// ---------------------------------------------------------------------------
// Parallel
// ---------------------------------------------------------------------------

export async function executeParallel(
	params: NormalizedParams,
	state: SkillState,
	ectx: ExecuteContext,
): Promise<AgentToolResult<TaskToolDetails>> {
	const prepared = prepareExecutions(
		params.items,
		state,
		params.model,
		params.thinking,
		params.timeout,
		ectx,
	);
	if (!prepared.ok) return errorResult(prepared.error, "parallel");

	const allResults = prepared.executions.map((exec, i) =>
		placeholderResult(
			exec.task.item,
			i + 1,
			exec.config.thinkingLevel,
			exec.config.modelLabel,
		),
	);

	const emitParallelUpdate = () => {
		if (!ectx.onUpdate) return;
		const done = allResults.filter((r) => r.exitCode !== -1).length;
		const toolActivity = formatToolCounts(allResults);
		const status = toolActivity
			? `Parallel: ${done}/${allResults.length} done · ${toolActivity}`
			: `Parallel: ${done}/${allResults.length} done`;
		ectx.onUpdate({
			content: [{ type: "text", text: status }],
			details: makeDetails("parallel", [...allResults]),
		});
	};
	emitParallelUpdate();

	const results = await mapWithConcurrency(
		prepared.executions,
		CONCURRENCY,
		async (exec, i) => {
			const result = await runSingleTask({
				cwd: resolveItemCwd(ectx.cwd, exec.task.item),
				item: exec.task.item,
				subprocessPrompt: exec.task.subprocessPrompt,
				index: i + 1,
				subprocessArgs: exec.config.subprocessArgs,
				modelLabel: exec.config.modelLabel,
				thinking: exec.config.thinkingLevel,
				timeout: exec.config.timeout,
				signal: ectx.signal,
				onResultUpdate: (partial) => {
					allResults[i] = partial;
					emitParallelUpdate();
				},
			});
			allResults[i] = result;
			emitParallelUpdate();
			return result;
		},
	);

	const successCount = results.filter((r) => !isTaskError2(r)).length;
	const summaries = results.map((r) => {
		const output = getFinalOutput(r.messages);
		const preview = output.slice(0, 200) + (output.length > 200 ? "..." : "");
		const label = r.skill ?? `task ${r.index ?? "?"}`;
		const status = isTaskError2(r) ? "failed" : "completed";
		return `[${label}] ${status}: ${preview || "(no output)"}`;
	});

	return {
		content: [
			{ type: "text", text: `Parallel: ${successCount}/${results.length} succeeded\n\n${summaries.join("\n\n")}` },
		],
		details: makeDetails("parallel", results),
	};
}
