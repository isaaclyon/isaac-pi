import type { AgentMessage } from "@mariozechner/pi-coding-agent";
import type { LcmStore } from "./store.ts";
import type { MessageRecord } from "./types.ts";

const LCM_SUMMARY_PREFIX = "[LCM Summary]\n";

/**
 * Reconstruct an AgentMessage from a stored MessageRecord.
 *
 * Strategy:
 *  1. Parse contentJson as the full original AgentMessage (new format: full message stored).
 *  2. If contentJson is null, corrupt, or missing `role`, fall back to a synthetic
 *     user message built from contentText (plain text fallback).
 *
 * The fallback ensures assembly never throws on old/incomplete stored data.
 */
function reconstructMessage(record: MessageRecord): AgentMessage {
	if (record.contentJson !== null) {
		try {
			const parsed = JSON.parse(record.contentJson) as Record<string, unknown>;
			// Validate that this is a full message JSON (new format) by checking for `role`
			if (typeof parsed.role === "string") {
				return parsed as unknown as AgentMessage;
			}
			// Old format: contentJson is just the content array — wrap into a user message
			return {
				role: "user",
				content: Array.isArray(parsed)
					? (parsed as AgentMessage["content"])
					: [{ type: "text" as const, text: record.contentText }],
				timestamp: record.createdAt,
			} as unknown as AgentMessage;
		} catch {
			// Fall through to text fallback
		}
	}
	// Text-only fallback: synthesize a user message so assembly never throws
	return {
		role: "user",
		content: [{ type: "text" as const, text: record.contentText }],
		timestamp: record.createdAt,
	} as unknown as AgentMessage;
}

/**
 * Assemble an AgentMessage[] from the ordered context_items for a conversation.
 *
 * - `message` items   → reconstructed from stored contentJson (full round-trip)
 * - `summary` items   → synthetic user message with [LCM Summary] prefix (mirrors pi's
 *                        compactionSummary → user-role pattern in convertToLlm)
 *
 * Returns [] if no context_items exist (caller should leave native context intact).
 */
export function assembleContext(store: LcmStore, conversationId: number): AgentMessage[] {
	const items = store.listContextItems(conversationId);
	if (items.length === 0) {
		return [];
	}

	// Batch-fetch all needed rows up front
	const messageIds = items
		.filter((item) => item.itemType === "message" && item.messageId !== null)
		.map((item) => item.messageId as number);
	const summaryIds = items
		.filter((item) => item.itemType === "summary" && item.summaryId !== null)
		.map((item) => item.summaryId as string);

	const messageRows = store.getMessagesByIds(messageIds);
	const summaryRows = store.getSummaryRows(summaryIds);

	const messageMap = new Map<number, MessageRecord>(messageRows.map((r) => [r.messageId, r]));
	const summaryMap = new Map(summaryRows.map((r) => [r.summaryId, r]));

	const assembled: AgentMessage[] = [];

	for (const item of items) {
		if (item.itemType === "summary" && item.summaryId !== null) {
			const summary = summaryMap.get(item.summaryId);
			if (!summary) {
				continue;
			}
			// Inject as a user message with the [LCM Summary] prefix so the LLM
			// understands it's compressed context, not a live turn.
			assembled.push({
				role: "user",
				content: [{ type: "text" as const, text: LCM_SUMMARY_PREFIX + summary.content }],
				timestamp: item.createdAt,
			} as unknown as AgentMessage);
		} else if (item.itemType === "message" && item.messageId !== null) {
			const record = messageMap.get(item.messageId);
			if (!record) {
				continue;
			}
			assembled.push(reconstructMessage(record));
		}
	}

	return assembled;
}
