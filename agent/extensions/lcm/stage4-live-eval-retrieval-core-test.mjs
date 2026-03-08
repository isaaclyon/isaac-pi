import assert from "node:assert/strict";

import { runRetrievalAwareEval } from "./stage4-live-eval-retrieval-core.ts";

function assistantMessage(content, stopReason = "stop") {
	return {
		role: "assistant",
		content,
		stopReason,
		timestamp: Date.now(),
	};
}

async function testSingleToolThenAnswer() {
	const calls = [];
	const result = await runRetrievalAwareEval({
		systemPrompt: "sys",
		userPrompt: "Find fact IDs",
		maxSteps: 3,
		maxToolCalls: 3,
		tools: [
			{
				name: "lcm_grep",
				description: "grep",
				parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
				execute: async (args) => {
					calls.push(args);
					return {
						content: [{ type: "text", text: "FACT_ALPHA_19" }],
						details: { ok: true },
					};
				},
			},
		],
		complete: async ({ messages }) => {
			const toolResults = messages.filter((m) => m.role === "toolResult");
			if (toolResults.length === 0) {
				return assistantMessage([
					{ type: "toolCall", id: "call_1", name: "lcm_grep", arguments: { pattern: "FACT_ALPHA_19" } },
				], "toolUse");
			}
			return assistantMessage([{ type: "text", text: "FACT_ALPHA_19" }], "stop");
		},
	});

	assert.equal(result.finalAnswer, "FACT_ALPHA_19");
	assert.equal(result.modelCalls, 2);
	assert.equal(result.steps, 2);
	assert.equal(result.used, true);
	assert.equal(result.toolCallCount, 1);
	assert.equal(result.toolErrorCount, 0);
	assert.deepEqual(result.toolNames, ["lcm_grep"]);
	assert.equal(calls.length, 1);
}

async function testUnknownToolIsCapturedAsError() {
	const result = await runRetrievalAwareEval({
		systemPrompt: "sys",
		userPrompt: "Find fact IDs",
		maxSteps: 2,
		maxToolCalls: 2,
		tools: [],
		complete: async ({ messages }) => {
			const toolResults = messages.filter((m) => m.role === "toolResult");
			if (toolResults.length === 0) {
				return assistantMessage([
					{ type: "toolCall", id: "unknown_1", name: "lcm_missing", arguments: { id: "x" } },
				], "toolUse");
			}
			return assistantMessage([{ type: "text", text: "NONE" }], "stop");
		},
	});

	assert.equal(result.finalAnswer, "NONE");
	assert.equal(result.toolCallCount, 1);
	assert.equal(result.toolErrorCount, 1);
	assert.equal(result.toolCalls[0].isError, true);
	assert.equal(result.toolCalls[0].toolName, "lcm_missing");
}

async function testToolCallBudgetCapsExecution() {
	const result = await runRetrievalAwareEval({
		systemPrompt: "sys",
		userPrompt: "Find fact IDs",
		maxSteps: 2,
		maxToolCalls: 1,
		tools: [
			{
				name: "lcm_grep",
				description: "grep",
				parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
				execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
			},
		],
		complete: async ({ messages }) => {
			const assistantTurns = messages.filter((m) => m.role === "assistant");
			if (assistantTurns.length === 0) {
				return assistantMessage([
					{ type: "toolCall", id: "call_a", name: "lcm_grep", arguments: { pattern: "FACT_" } },
					{ type: "toolCall", id: "call_b", name: "lcm_grep", arguments: { pattern: "BRAVO" } },
				], "toolUse");
			}
			return assistantMessage([{ type: "text", text: "FACT_ALPHA_19" }]);
		},
	});

	assert.equal(result.toolCallCount, 2);
	assert.equal(result.toolErrorCount, 1);
	assert.equal(result.toolCalls[1].isError, true);
}

async function testFallbackAnswerFromToolEvidence() {
	const result = await runRetrievalAwareEval({
		systemPrompt: "sys",
		userPrompt: "Find facts",
		maxSteps: 2,
		maxToolCalls: 3,
		candidateIds: ["FACT_ALPHA_19", "FACT_BRAVO_42"],
		tools: [
			{
				name: "lcm_grep",
				description: "grep",
				parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] },
				execute: async () => ({ content: [{ type: "text", text: "evidence: FACT_ALPHA_19 and FACT_BRAVO_42" }], details: {} }),
			},
		],
		complete: async ({ messages }) => {
			const assistantTurns = messages.filter((m) => m.role === "assistant").length;
			if (assistantTurns === 0) {
				return assistantMessage([{ type: "toolCall", id: "call_1", name: "lcm_grep", arguments: { pattern: "FACT_" } }], "toolUse");
			}
			return assistantMessage([{ type: "toolCall", id: "call_2", name: "lcm_grep", arguments: { pattern: "ALPHA" } }], "toolUse");
		},
	});

	assert.equal(result.finalAnswer, "FACT_ALPHA_19, FACT_BRAVO_42");
}

async function run() {
	await testSingleToolThenAnswer();
	await testUnknownToolIsCapturedAsError();
	await testToolCallBudgetCapsExecution();
	await testFallbackAnswerFromToolEvidence();
	console.log("stage4-live-eval-retrieval-core tests passed");
}

run();
