export type RetrievalToolDescriptor = {
	name: string;
	description: string;
	parameters: Record<string, unknown>;
	execute: (args: Record<string, unknown>) =>
		| Promise<{ content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown>; isError?: boolean }>
		| { content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown>; isError?: boolean };
};

export type RetrievalToolCallTelemetry = {
	toolCallId: string;
	toolName: string;
	isError: boolean;
};

export type RetrievalAwareEvalResult = {
	finalAnswer: string;
	modelCalls: number;
	steps: number;
	used: boolean;
	toolCallCount: number;
	toolErrorCount: number;
	toolNames: string[];
	toolCalls: RetrievalToolCallTelemetry[];
	messages: Array<Record<string, unknown>>;
};

export type RetrievalEvalContext = {
	systemPrompt: string;
	messages: Array<Record<string, unknown>>;
	tools: Array<{ name: string; description: string; parameters: Record<string, unknown> }>;
};

export async function runRetrievalAwareEval(input: {
	systemPrompt: string;
	userPrompt: string;
	maxSteps: number;
	maxToolCalls: number;
	candidateIds?: string[];
	tools: RetrievalToolDescriptor[];
	complete: (ctx: RetrievalEvalContext) => Promise<Record<string, unknown>>;
	now?: () => number;
}): Promise<RetrievalAwareEvalResult> {
	if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1) {
		throw new Error(`maxSteps invalid: ${input.maxSteps}. Expected an integer >= 1.`);
	}
	if (!Number.isInteger(input.maxToolCalls) || input.maxToolCalls < 1) {
		throw new Error(`maxToolCalls invalid: ${input.maxToolCalls}. Expected an integer >= 1.`);
	}

	const now = input.now ?? (() => Date.now());
	const toolsByName = new Map(input.tools.map((tool) => [tool.name, tool]));
	const messages: Array<Record<string, unknown>> = [
		{
			role: "user",
			content: input.userPrompt,
			timestamp: now(),
		},
	];
	const toolCalls: RetrievalToolCallTelemetry[] = [];
	let modelCalls = 0;
	let nudgedForTools = false;
	let finalAssistant: Record<string, unknown> | null = null;

	for (let step = 1; step <= input.maxSteps; step += 1) {
		const assistant = await input.complete({
			systemPrompt: input.systemPrompt,
			messages: [...messages],
			tools: input.tools.map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
		});
		modelCalls += 1;
		finalAssistant = assistant;
		messages.push(assistant);

		const stopReason = String((assistant as { stopReason?: unknown }).stopReason ?? "").toLowerCase();
		if (stopReason === "error" || stopReason === "aborted") {
			break;
		}

		const content = Array.isArray((assistant as { content?: unknown }).content)
			? ((assistant as { content: Array<Record<string, unknown>> }).content)
			: [];
		const calls = content.filter((block) => {
			return block && typeof block === "object" && block.type === "toolCall";
		});
		if (calls.length === 0) {
			if (!nudgedForTools && toolCalls.length === 0 && input.tools.length > 0 && step < input.maxSteps) {
				nudgedForTools = true;
				messages.push({
					role: "user",
					content:
						"Use at least one retrieval tool before finalizing. " +
						"Recommended: call lcm_grep with pattern='FACT_' or with individual candidate IDs.",
					timestamp: now(),
				});
				continue;
			}
			break;
		}

		for (const call of calls) {
			const toolName = String(call.name ?? "").trim();
			const toolCallId = String(call.id ?? `tool_${toolCalls.length + 1}`).trim() || `tool_${toolCalls.length + 1}`;
			const args =
				call.arguments && typeof call.arguments === "object" && !Array.isArray(call.arguments)
					? (call.arguments as Record<string, unknown>)
					: {};

			let isError = false;
			let toolResult: { content: Array<{ type: "text"; text: string }>; details?: Record<string, unknown>; isError?: boolean };
			if (toolCalls.length >= input.maxToolCalls) {
				isError = true;
				toolResult = {
					content: [{ type: "text", text: `Retrieval tool-call budget exceeded (${toolCalls.length} >= ${input.maxToolCalls}).` }],
					details: { reason: "tool-call-budget" },
					isError: true,
				};
			} else {
				const tool = toolsByName.get(toolName);
				if (!tool) {
					isError = true;
					toolResult = {
						content: [{ type: "text", text: `Unknown retrieval tool: ${toolName}` }],
						details: { reason: "unknown-tool", toolName },
						isError: true,
					};
				} else {
					try {
						const raw = await tool.execute(args);
						const normalizedContent =
							Array.isArray(raw.content) && raw.content.length > 0
								? raw.content
								: [{ type: "text", text: "(empty tool response)" }];
						isError = Boolean(raw.isError);
						toolResult = {
							content: normalizedContent,
							details: raw.details ?? {},
							isError,
						};
					} catch (error) {
						isError = true;
						toolResult = {
							content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
							details: { reason: "tool-exception" },
							isError: true,
						};
					}
				}
			}

			toolCalls.push({ toolCallId, toolName, isError });
			messages.push({
				role: "toolResult",
				toolCallId,
				toolName,
				content: toolResult.content,
				details: toolResult.details ?? {},
				isError,
				timestamp: now(),
			});
		}
	}

	let finalAnswer = extractAssistantText(finalAssistant);
	if (!finalAnswer.trim() && Array.isArray(input.candidateIds) && input.candidateIds.length > 0 && toolCalls.length > 0) {
		const toolText = messages
			.filter((message) => message.role === "toolResult")
			.map((message) => {
				const content = Array.isArray(message.content) ? message.content : [];
				return content
					.filter((block) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
					.map((block) => String(block.text))
					.join("\n");
			})
			.join("\n")
			.toLowerCase();
		const found = input.candidateIds.filter((candidate) => toolText.includes(candidate.toLowerCase()));
		finalAnswer = found.length > 0 ? found.join(", ") : "NONE";
	}
	return {
		finalAnswer,
		modelCalls,
		steps: modelCalls,
		used: toolCalls.length > 0,
		toolCallCount: toolCalls.length,
		toolErrorCount: toolCalls.filter((call) => call.isError).length,
		toolNames: [...new Set(toolCalls.map((call) => call.toolName).filter((name) => name.length > 0))],
		toolCalls,
		messages,
	};
}

function extractAssistantText(message: Record<string, unknown> | null): string {
	if (!message || !Array.isArray(message.content)) {
		return "";
	}
	return message.content
		.filter((block) => block && typeof block === "object" && block.type === "text" && typeof block.text === "string")
		.map((block) => String(block.text))
		.join("\n")
		.trim();
}
