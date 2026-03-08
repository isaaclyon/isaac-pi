import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { LcmStore, SummaryWithProvenance } from "./store.ts";
import type { MessageRecord } from "./types.ts";

export type LcmRetrievalRuntime = {
	enabled: boolean;
	store?: LcmStore;
	conversationId?: number;
};

export type LcmRetrievalRuntimeGetter = () => LcmRetrievalRuntime;

const DescribeParams = {
	type: "object",
	properties: {
		id: { type: "string", minLength: 1, description: "Summary id (e.g. lcm_leaf_0_...)" },
	},
	required: ["id"],
	additionalProperties: false,
} as const;

const GrepParams = {
	type: "object",
	properties: {
		pattern: {
			type: "string",
			minLength: 1,
			description: "Substring pattern to find in persisted message text",
		},
		summary_id: {
			type: "string",
			minLength: 1,
			description: "Optional summary id to scope grep to summary ancestry",
		},
	},
	required: ["pattern"],
	additionalProperties: false,
} as const;

const ExpandParams = {
	type: "object",
	properties: {
		summary_id: { type: "string", minLength: 1, description: "Summary id to expand into original source messages" },
	},
	required: ["summary_id"],
	additionalProperties: false,
} as const;

export const lcmToolSchemas = {
	lcm_describe: DescribeParams,
	lcm_grep: GrepParams,
	lcm_expand: ExpandParams,
};

function textResult(
	text: string,
	details: Record<string, unknown>,
	isError = false,
): { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown>; isError: boolean } {
	return {
		content: [{ type: "text", text }],
		details,
		isError,
	};
}

function getActiveStore(getRuntime: LcmRetrievalRuntimeGetter):
	| { ok: true; store: LcmStore; conversationId: number }
	| { ok: false; result: { content: Array<{ type: "text"; text: string }>; details: Record<string, unknown>; isError: boolean } } {
	const runtime = getRuntime();
	if (!runtime.enabled) {
		return {
			ok: false,
			result: textResult("LCM is disabled for this session.", { reason: "disabled" }, true),
		};
	}
	if (!runtime.store || typeof runtime.conversationId !== "number") {
		return {
			ok: false,
			result: textResult(
				"LCM has no active conversation yet. Start a conversation turn, then retry.",
				{ reason: "no-active-conversation" },
				true,
			),
		};
	}
	return {
		ok: true,
		store: runtime.store,
		conversationId: runtime.conversationId,
	};
}

function isLikelyFilePath(id: string): boolean {
	if (id.includes("/") || id.includes("\\")) {
		return true;
	}
	return /\.[a-z0-9]+$/i.test(id);
}

function messagePreview(text: string, maxChars = 120): string {
	const compact = text.replace(/\s+/g, " ").trim();
	if (!compact) {
		return "(empty)";
	}
	if (compact.length <= maxChars) {
		return compact;
	}
	return `${compact.slice(0, maxChars - 1)}…`;
}

function toToolMessage(message: MessageRecord): {
	messageId: number;
	seq: number;
	role: string;
	createdAt: number;
	contentText: string;
} {
	return {
		messageId: message.messageId,
		seq: message.seq,
		role: message.role,
		createdAt: message.createdAt,
		contentText: message.contentText,
	};
}

function formatDescribeText(summary: SummaryWithProvenance, sourceMessageCount: number): string {
	const lines = [
		`summary_id=${summary.summaryId}`,
		`kind=${summary.kind} depth=${summary.depth}`,
		`token_estimate=${summary.tokenEstimate}`,
		`created_at=${summary.createdAt}`,
		`earliest_at=${summary.earliestAt ?? "null"} latest_at=${summary.latestAt ?? "null"}`,
		`parents=${summary.parentSummaryIds.length} direct_messages=${summary.directMessageIds.length} source_messages=${sourceMessageCount}`,
	];
	if (summary.parentSummaryIds.length > 0) {
		lines.push(`parent_ids=${summary.parentSummaryIds.join(",")}`);
	}
	if (summary.directMessageIds.length > 0) {
		lines.push(`direct_message_ids=${summary.directMessageIds.join(",")}`);
	}
	return lines.join("\n");
}

function formatGrepText(pattern: string, summaryId: string | undefined, matches: MessageRecord[]): string {
	if (matches.length === 0) {
		return summaryId
			? `No matches for pattern '${pattern}' within summary ${summaryId}.`
			: `No matches for pattern '${pattern}'.`;
	}

	const header = summaryId
		? `Found ${matches.length} match(es) for '${pattern}' within summary ${summaryId}:`
		: `Found ${matches.length} match(es) for '${pattern}':`;
	const previewLines = matches.slice(0, 20).map((message) => {
		return `- #${message.seq} ${message.role} (message_id=${message.messageId}): ${messagePreview(message.contentText)}`;
	});
	return [header, ...previewLines].join("\n");
}

function formatExpandText(summaryId: string, messages: MessageRecord[]): string {
	const lines = [`Expanded ${summaryId} to ${messages.length} source message(s).`];
	for (const message of messages.slice(0, 20)) {
		lines.push(`- #${message.seq} ${message.role} (message_id=${message.messageId}): ${messagePreview(message.contentText)}`);
	}
	return lines.join("\n");
}

export function isSubAgentContext(ctx: ExtensionContext): boolean {
	const header = ctx.sessionManager.getHeader();
	if (!header) {
		return false;
	}
	return typeof header.parentSession === "string" && header.parentSession.trim().length > 0;
}

export function registerLcmRetrievalTools(pi: Pick<ExtensionAPI, "registerTool">, getRuntime: LcmRetrievalRuntimeGetter): void {
	pi.registerTool({
		name: "lcm_describe",
		label: "lcm_describe",
		description: "Describe an LCM summary node by id, including depth, kind, and provenance pointers.",
		parameters: DescribeParams,
		async execute(_toolCallId, params) {
			const active = getActiveStore(getRuntime);
			if (!active.ok) {
				return active.result;
			}

			const id = String((params as { id: string }).id ?? "").trim();
			if (!id) {
				return textResult("lcm_describe requires id.", { reason: "missing-id" }, true);
			}
			if (isLikelyFilePath(id)) {
				return textResult(
					`lcm_describe expects an LCM summary id, not a file path: '${id}'.`,
					{ reason: "file-like-id", id },
					true,
				);
			}

			const summary = active.store.getSummaryWithProvenance(active.conversationId, id);
			if (!summary) {
				return textResult(`Unknown summary id: ${id}`, { reason: "unknown-summary", id }, true);
			}

			const sourceMessages = active.store.expandSummaryMessages(active.conversationId, id);
			return textResult(
				formatDescribeText(summary, sourceMessages.length),
				{ summary: { ...summary, sourceMessageCount: sourceMessages.length } },
				false,
			);
		},
	});

	pi.registerTool({
		name: "lcm_grep",
		label: "lcm_grep",
		description: "Search persisted LCM message history for a substring, optionally scoped to a summary node.",
		parameters: GrepParams,
		async execute(_toolCallId, params) {
			const active = getActiveStore(getRuntime);
			if (!active.ok) {
				return active.result;
			}

			const pattern = String((params as { pattern: string }).pattern ?? "").trim();
			if (!pattern) {
				return textResult("lcm_grep requires pattern.", { reason: "missing-pattern" }, true);
			}

			const summaryIdRaw = (params as { summary_id?: string }).summary_id;
			const summaryId = typeof summaryIdRaw === "string" ? summaryIdRaw.trim() : undefined;

			let scopedMessageIds: number[] | undefined;
			if (summaryId) {
				const summary = active.store.getSummaryWithProvenance(active.conversationId, summaryId);
				if (!summary) {
					return textResult(`Unknown summary id: ${summaryId}`, { reason: "unknown-summary", summaryId }, true);
				}
				scopedMessageIds = active.store
					.expandSummaryMessages(active.conversationId, summaryId)
					.map((message) => message.messageId);
			}

			const matches = active.store.searchMessages(active.conversationId, pattern, scopedMessageIds);
			return textResult(
				formatGrepText(pattern, summaryId, matches),
				{ pattern, summaryId: summaryId ?? null, matchCount: matches.length, matches: matches.map(toToolMessage) },
				false,
			);
		},
	});

	pi.registerTool({
		name: "lcm_expand",
		label: "lcm_expand",
		description: "Expand an LCM summary id into the ordered source messages that summary represents.",
		parameters: ExpandParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!isSubAgentContext(ctx)) {
				return textResult(
					"lcm_expand is restricted to sub-agent sessions. Use lcm_describe/lcm_grep from the root agent.",
					{ reason: "sub-agent-only" },
					true,
				);
			}

			const active = getActiveStore(getRuntime);
			if (!active.ok) {
				return active.result;
			}

			const summaryId = String((params as { summary_id: string }).summary_id ?? "").trim();
			if (!summaryId) {
				return textResult("lcm_expand requires summary_id.", { reason: "missing-summary-id" }, true);
			}

			const summary = active.store.getSummaryWithProvenance(active.conversationId, summaryId);
			if (!summary) {
				return textResult(`Unknown summary id: ${summaryId}`, { reason: "unknown-summary", summaryId }, true);
			}

			const messages = active.store.expandSummaryMessages(active.conversationId, summaryId);
			return textResult(
				formatExpandText(summaryId, messages),
				{ summaryId, messageCount: messages.length, messages: messages.map(toToolMessage) },
				false,
			);
		},
	});
}
