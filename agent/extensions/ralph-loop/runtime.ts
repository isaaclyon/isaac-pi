import type { RalphBudgetConfig } from "./types.js";

export type RalphLoopMetrics = {
	assistantTurns: number;
	toolCalls: number;
	contextTokens: number;
};

export type RalphLoopTriggerReason = "context_threshold" | "assistant_turn_cap" | "tool_call_cap";

export function chooseLoopTrigger(
	metrics: RalphLoopMetrics,
	budget: RalphBudgetConfig,
	modelContextWindowTokens: number,
): RalphLoopTriggerReason | null {
	const thresholdTokens = Math.floor(modelContextWindowTokens * (budget.contextThresholdPercent / 100));
	if (metrics.contextTokens >= thresholdTokens) {
		return "context_threshold";
	}

	if (typeof budget.maxAssistantTurns === "number" && metrics.assistantTurns >= budget.maxAssistantTurns) {
		return "assistant_turn_cap";
	}

	if (typeof budget.maxToolCalls === "number" && metrics.toolCalls >= budget.maxToolCalls) {
		return "tool_call_cap";
	}

	return null;
}

export function updateMetricsFromJsonLine(metrics: RalphLoopMetrics, line: string): RalphLoopMetrics {
	let parsed: any;
	try {
		parsed = JSON.parse(line);
	} catch {
		return metrics;
	}

	if (parsed?.type !== "message_end" || !parsed.message || parsed.message.role !== "assistant") {
		return metrics;
	}

	const next: RalphLoopMetrics = {
		assistantTurns: metrics.assistantTurns + 1,
		toolCalls: metrics.toolCalls,
		contextTokens: metrics.contextTokens,
	};

	const usage = parsed.message.usage;
	if (usage && typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens)) {
		next.contextTokens = usage.totalTokens;
	}

	const content = Array.isArray(parsed.message.content) ? parsed.message.content : [];
	for (const block of content) {
		if (block && typeof block === "object" && block.type === "toolCall") {
			next.toolCalls += 1;
		}
	}

	return next;
}
