import { complete, type Message } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { convertToLlm, serializeConversation } from "@mariozechner/pi-coding-agent";

import {
	buildHandoffCompactionPrompt,
	extractTextContent,
	HANDOFF_SYSTEM_PROMPT,
} from "./_shared/handoff.js";

function computeCompactionDetails(fileOps: {
	read: Set<string>;
	written: Set<string>;
	edited: Set<string>;
}): { readFiles: string[]; modifiedFiles: string[] } {
	const modified = new Set([...fileOps.written, ...fileOps.edited]);
	const readFiles = [...fileOps.read].filter((path) => !modified.has(path)).sort();
	const modifiedFiles = [...modified].sort();
	return { readFiles, modifiedFiles };
}

export default function customCompactionHandoffExtension(pi: ExtensionAPI): void {
	pi.on("session_before_compact", async (event, ctx) => {
		if (!ctx.model) return;

		const apiKey = await ctx.modelRegistry.getApiKey(ctx.model);
		if (!apiKey) return;

		const messages = [...event.preparation.messagesToSummarize, ...event.preparation.turnPrefixMessages];
		const llmMessages = convertToLlm(messages);
		const conversationText = serializeConversation(llmMessages);

		const userMessage: Message = {
			role: "user",
			content: [
				{
					type: "text",
					text: buildHandoffCompactionPrompt({
						conversationText,
						previousSummary: event.preparation.previousSummary,
						customInstructions: event.customInstructions,
						isSplitTurn: event.preparation.isSplitTurn,
					}),
				},
			],
			timestamp: Date.now(),
		};

		try {
			const maxTokens = Math.floor(0.8 * event.preparation.settings.reserveTokens);
			const response = await complete(
				ctx.model,
				{ systemPrompt: HANDOFF_SYSTEM_PROMPT, messages: [userMessage] },
				{ apiKey, signal: event.signal, maxTokens },
			);

			if (response.stopReason === "aborted") return;
			if (response.stopReason === "error") {
				if (ctx.hasUI) {
					ctx.ui.notify(`Global handoff compaction failed: ${response.errorMessage || "unknown error"}`, "warning");
				}
				return;
			}

			const summary = extractTextContent(response.content);
			if (!summary) return;

			return {
				compaction: {
					summary,
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					details: computeCompactionDetails(event.preparation.fileOps),
				},
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.error("Global handoff compaction failed:", error);
			if (ctx.hasUI) {
				ctx.ui.notify(`Global handoff compaction failed: ${message}`, "warning");
			}
			return;
		}
	});
}
