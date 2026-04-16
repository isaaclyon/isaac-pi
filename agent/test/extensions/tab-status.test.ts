import { describe, expect, it } from "vitest";

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import {
	buildSessionSummaryInput,
	extractConversationPairs,
	getSummaryThresholdToEvaluate,
	parseStructuredSessionLabel,
} from "../../extensions/tab-status.js";

const userMessage = (text: string): AgentMessage => ({
	role: "user",
	content: text,
	timestamp: 0,
}) as AgentMessage;

const assistantMessage = (text: string): AgentMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	timestamp: 0,
}) as AgentMessage;

describe("tab status session pair extraction", () => {
	it("treats consecutive user messages as one exchange pair", () => {
		const pairs = extractConversationPairs([
			userMessage("Need the tab label to summarize the session."),
			userMessage("Use the first and latest exchanges."),
			assistantMessage("I can do that with a compact session summary."),
		]);

		expect(pairs).toEqual([
			{
				user: "Need the tab label to summarize the session.\nUse the first and latest exchanges.",
				assistant: "I can do that with a compact session summary.",
			},
		]);
	});
});

describe("tab status summary input", () => {
	it("uses the first two and last two exchange pairs", () => {
		const messages: AgentMessage[] = [
			userMessage("pair one user"),
			assistantMessage("pair one assistant"),
			userMessage("pair two user"),
			assistantMessage("pair two assistant"),
			userMessage("pair three user"),
			assistantMessage("pair three assistant"),
			userMessage("pair four user"),
			assistantMessage("pair four assistant"),
			userMessage("pair five user"),
			assistantMessage("pair five assistant"),
		];

		const input = buildSessionSummaryInput(messages);

		expect(input).toContain("Opening session pairs");
		expect(input).toContain("pair one user");
		expect(input).toContain("pair two assistant");
		expect(input).toContain("Recent session pairs");
		expect(input).toContain("pair four user");
		expect(input).toContain("pair five assistant");
		expect(input).not.toContain("pair three user");
		expect(input).not.toContain("pair three assistant");
	});
});

describe("tab status summary cadence", () => {
	it("only evaluates on a new four-pair boundary", () => {
		expect(getSummaryThresholdToEvaluate(3, 0)).toBeNull();
		expect(getSummaryThresholdToEvaluate(4, 0)).toBe(4);
		expect(getSummaryThresholdToEvaluate(7, 4)).toBeNull();
		expect(getSummaryThresholdToEvaluate(8, 4)).toBe(8);
	});
});

describe("tab status structured label parsing", () => {
	it("parses JSON output and enforces a four-word cap", () => {
		const label = parseStructuredSessionLabel('{"label":"  Fix tab status summarizer today!!  "}');

		expect(label).toBe("Fix tab status summarizer");
	});

	it("rejects non-JSON output", () => {
		expect(parseStructuredSessionLabel("Fix tab status summarizer")).toBe("");
	});
});
