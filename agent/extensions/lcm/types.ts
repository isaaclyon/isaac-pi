import type { AgentMessage } from "@mariozechner/pi-agent-core";

export type SessionMessageEntryLike = {
	id: string;
	type: "message";
	message: AgentMessage;
};

export type StoredMessage = {
	entryId: string | null;
	role: string;
	contentText: string;
	contentJson: string | null;
	tokenEstimate: number;
	createdAt: number;
};

export type ConversationIdentity = {
	conversationKey: string;
	sessionFile: string | null;
	cwd: string;
};

export type ConversationRecord = {
	conversationId: number;
	conversationKey: string;
	sessionFile: string | null;
	cwd: string;
};

export type SummaryKind = "leaf" | "condensed";

export type ContextItemType = "message" | "summary";

export type ContextItemRecord = {
	contextItemId: number;
	ordinal: number;
	itemType: ContextItemType;
	messageId: number | null;
	summaryId: string | null;
	tokenEstimate: number;
	createdAt: number;
	summaryDepth: number | null;
};

export type ContextItemWrite = {
	itemType: ContextItemType;
	messageId: number | null;
	summaryId: string | null;
	createdAt: number;
};

export type MessageRecord = {
	messageId: number;
	seq: number;
	role: string;
	contentText: string;
	contentJson: string | null;
	tokenEstimate: number;
	createdAt: number;
};

export type SummaryRecord = {
	summaryId: string;
	depth: number;
	kind: SummaryKind;
	content: string;
	tokenEstimate: number;
	earliestAt: number | null;
	latestAt: number | null;
	createdAt: number;
};

export function estimateTokens(value: string): number {
	return Math.ceil(value.length / 4);
}

function flattenTextBlocks(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}

	const lines: string[] = [];
	for (const part of content) {
		if (!part || typeof part !== "object") {
			continue;
		}
		const block = part as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") {
			lines.push(block.text);
			continue;
		}
		if (block.type === "thinking" && typeof block.thinking === "string") {
			lines.push(block.thinking);
			continue;
		}
		if (block.type === "toolCall") {
			const name = typeof block.name === "string" ? block.name : "unknown_tool";
			lines.push(`[toolCall] ${name}`);
		}
	}
	return lines.join("\n");
}

function stringifyJson(value: unknown): string | null {
	if (value === undefined) {
		return null;
	}
	const raw = JSON.stringify(value);
	return typeof raw === "string" ? raw : null;
}

export function toStoredMessage(message: AgentMessage, entryId: string | null): StoredMessage {
	const timestamp =
		typeof (message as { timestamp?: unknown }).timestamp === "number"
			? ((message as { timestamp: number }).timestamp ?? Date.now())
			: Date.now();

	switch (message.role) {
		case "user":
		case "assistant":
		case "toolResult":
		case "custom": {
			const content = (message as { content?: unknown }).content;
			const text = flattenTextBlocks(content);
			return {
				entryId,
				role: message.role,
				contentText: text,
				contentJson: stringifyJson(message),
				tokenEstimate: estimateTokens(text),
				createdAt: timestamp,
			};
		}
		case "bashExecution": {
			const bashMessage = message as {
				command?: string;
				output?: string;
				cancelled?: boolean;
				exitCode?: number;
			};
			const text = `$ ${bashMessage.command ?? ""}\n${bashMessage.output ?? ""}`.trim();
			return {
				entryId,
				role: "bashExecution",
				contentText: text,
				contentJson: stringifyJson({
					command: bashMessage.command ?? "",
					output: bashMessage.output ?? "",
					cancelled: bashMessage.cancelled ?? false,
					exitCode: bashMessage.exitCode,
				}),
				tokenEstimate: estimateTokens(text),
				createdAt: timestamp,
			};
		}
		case "compactionSummary": {
			const text = (message as { summary?: string }).summary ?? "";
			return {
				entryId,
				role: "compactionSummary",
				contentText: text,
				contentJson: stringifyJson(message),
				tokenEstimate: estimateTokens(text),
				createdAt: timestamp,
			};
		}
		case "branchSummary": {
			const text = (message as { summary?: string }).summary ?? "";
			return {
				entryId,
				role: "branchSummary",
				contentText: text,
				contentJson: stringifyJson(message),
				tokenEstimate: estimateTokens(text),
				createdAt: timestamp,
			};
		}
		default: {
			const fallback = stringifyJson(message) ?? "";
			return {
				entryId,
				role: "unknown",
				contentText: fallback,
				contentJson: fallback || null,
				tokenEstimate: estimateTokens(fallback),
				createdAt: timestamp,
			};
		}
	}
}

export function toStoredFromEntry(entry: SessionMessageEntryLike): StoredMessage {
	return toStoredMessage(entry.message, entry.id);
}
