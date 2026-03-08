import { describe, expect, it } from "vitest";
import { chooseLoopTrigger, updateMetricsFromJsonLine } from "./runtime.js";

describe("chooseLoopTrigger", () => {
	it("prefers context threshold when exceeded", () => {
		const trigger = chooseLoopTrigger(
			{ assistantTurns: 1, toolCalls: 1, contextTokens: 60_000 },
			{ contextThresholdPercent: 50, maxAssistantTurns: 5, maxToolCalls: 10 },
			100_000,
		);
		expect(trigger).toBe("context_threshold");
	});

	it("falls back to assistant turn cap", () => {
		const trigger = chooseLoopTrigger(
			{ assistantTurns: 5, toolCalls: 1, contextTokens: 10_000 },
			{ contextThresholdPercent: 80, maxAssistantTurns: 5, maxToolCalls: 10 },
			100_000,
		);
		expect(trigger).toBe("assistant_turn_cap");
	});

	it("falls back to tool call cap", () => {
		const trigger = chooseLoopTrigger(
			{ assistantTurns: 1, toolCalls: 10, contextTokens: 10_000 },
			{ contextThresholdPercent: 80, maxAssistantTurns: 5, maxToolCalls: 10 },
			100_000,
		);
		expect(trigger).toBe("tool_call_cap");
	});

	it("returns null when no budget boundary crossed", () => {
		const trigger = chooseLoopTrigger(
			{ assistantTurns: 2, toolCalls: 3, contextTokens: 10_000 },
			{ contextThresholdPercent: 80, maxAssistantTurns: 5, maxToolCalls: 10 },
			100_000,
		);
		expect(trigger).toBeNull();
	});

	it("updates metrics from assistant json event line", () => {
		const line = JSON.stringify({
			type: "message_end",
			message: {
				role: "assistant",
				usage: { totalTokens: 42_000 },
				content: [
					{ type: "text", text: "Working" },
					{ type: "toolCall", name: "bash", arguments: { command: "echo hi" } },
				],
			},
		});

		const updated = updateMetricsFromJsonLine(
			{ assistantTurns: 0, toolCalls: 0, contextTokens: 0 },
			line,
		);

		expect(updated.assistantTurns).toBe(1);
		expect(updated.toolCalls).toBe(1);
		expect(updated.contextTokens).toBe(42_000);
	});
});
