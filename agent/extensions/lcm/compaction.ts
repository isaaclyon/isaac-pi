import { createHash } from "node:crypto";
import { estimateTokens, type ContextItemRecord, type ContextItemWrite, type MessageRecord } from "./types.js";
import { LcmStore } from "./store.js";

type CompactionStrategy = "normal" | "aggressive" | "fallback";

export type RunLcmCompactionOptions = {
	conversationId: number;
	targetTokens: number;
	freshTailCount: number;
	leafChunkTokens: number;
	incrementalMaxDepth: number;
};

export type RunLcmCompactionResult = {
	compacted: boolean;
	initialTokens: number;
	finalTokens: number;
	createdLeafCount: number;
	createdCondensedCount: number;
	strategyUsed: CompactionStrategy | null;
};

type SummaryNode = {
	summaryId: string;
	depth: number;
	kind: "leaf" | "condensed";
	content: string;
	tokenEstimate: number;
	createdAt: number;
	earliestAt: number | null;
	latestAt: number | null;
};

const STRATEGIES: CompactionStrategy[] = ["normal", "aggressive", "fallback"];
const MAX_PASSES_PER_STRATEGY = 24;
const MAX_FANOUT = 4;

function normalizeText(value: string, maxChars: number): string {
	const oneLine = value.replace(/\s+/g, " ").trim();
	if (!oneLine) {
		return "(empty)";
	}
	if (oneLine.length <= maxChars) {
		return oneLine;
	}
	return `${oneLine.slice(0, maxChars - 1)}…`;
}

function makeSummaryId(
	conversationId: number,
	kind: "leaf" | "condensed",
	depth: number,
	strategy: CompactionStrategy,
	parts: Array<string | number>,
): string {
	const raw = `${conversationId}|${kind}|${depth}|${strategy}|${parts.join("|")}`;
	const digest = createHash("sha1").update(raw).digest("hex").slice(0, 16);
	return `lcm_${kind}_${depth}_${digest}`;
}

function toWriteItem(item: ContextItemRecord): ContextItemWrite {
	return {
		itemType: item.itemType,
		messageId: item.messageId,
		summaryId: item.summaryId,
		createdAt: item.createdAt,
	};
}

function replaceRangeWithSummary(
	store: LcmStore,
	conversationId: number,
	startOrdinal: number,
	endOrdinal: number,
	summaryId: string,
	createdAt: number,
): void {
	const items = store.listContextItems(conversationId);
	const next: ContextItemWrite[] = [];
	for (const item of items) {
		if (item.ordinal < startOrdinal || item.ordinal > endOrdinal) {
			next.push(toWriteItem(item));
			continue;
		}
		if (item.ordinal === startOrdinal) {
			next.push({
				itemType: "summary",
				messageId: null,
				summaryId,
				createdAt,
			});
		}
	}
	store.setContextItems(conversationId, next);
}

function getEvictableItems(items: ContextItemRecord[], freshTailCount: number): ContextItemRecord[] {
	const messageItems = items.filter((item) => item.itemType === "message" && item.messageId !== null);
	if (messageItems.length <= freshTailCount) {
		return [];
	}
	const protectedStartOrdinal = messageItems[messageItems.length - freshTailCount].ordinal;
	return items.filter((item) => item.ordinal < protectedStartOrdinal);
}

function buildLeafSummary(
	conversationId: number,
	messages: MessageRecord[],
	strategy: CompactionStrategy,
): SummaryNode {
	const depth = 0;
	const createdAt = Date.now();
	const earliestAt = messages[0]?.createdAt ?? null;
	const latestAt = messages[messages.length - 1]?.createdAt ?? null;
	const totalTokens = messages.reduce((sum, message) => sum + message.tokenEstimate, 0);
	const firstSeq = messages[0]?.seq ?? 0;
	const lastSeq = messages[messages.length - 1]?.seq ?? 0;

	let content = "";
	if (strategy === "normal") {
		const lines = messages.slice(0, 8).map((message) => `- ${message.role}#${message.seq}: ${normalizeText(message.contentText, 180)}`);
		content = [
			`[lcm leaf normal depth=0]`,
			`messages=${messages.length} seq=${firstSeq}-${lastSeq} tokens=${totalTokens}`,
			...lines,
		].join("\n");
	} else if (strategy === "aggressive") {
		const lines = messages.slice(0, 4).map((message) => `- ${message.role}#${message.seq}: ${normalizeText(message.contentText, 90)}`);
		content = [
			`[lcm leaf aggressive depth=0]`,
			`messages=${messages.length} seq=${firstSeq}-${lastSeq}`,
			...lines,
		].join("\n");
	} else {
		const roleCounts = new Map<string, number>();
		for (const message of messages) {
			roleCounts.set(message.role, (roleCounts.get(message.role) ?? 0) + 1);
		}
		const roles = Array.from(roleCounts.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([role, count]) => `${role}:${count}`)
			.join(",");
		content = [
			`[lcm leaf fallback depth=0]`,
			`messages=${messages.length} seq=${firstSeq}-${lastSeq}`,
			`roles=${roles || "none"}`,
		].join("\n");
	}

	const summaryId = makeSummaryId(
		conversationId,
		"leaf",
		depth,
		strategy,
		messages.map((message) => message.messageId),
	);
	return {
		summaryId,
		depth,
		kind: "leaf",
		content,
		tokenEstimate: estimateTokens(content),
		createdAt,
		earliestAt,
		latestAt,
	};
}

function buildCondensedSummary(
	conversationId: number,
	depth: number,
	strategy: CompactionStrategy,
	parents: Array<{ summaryId: string; content: string; tokenEstimate: number; createdAt: number }>,
): SummaryNode {
	const createdAt = Date.now();
	const earliestAt = parents[0]?.createdAt ?? null;
	const latestAt = parents[parents.length - 1]?.createdAt ?? null;
	const totalTokens = parents.reduce((sum, parent) => sum + parent.tokenEstimate, 0);

	let content = "";
	if (strategy === "normal") {
		content = [
			`[lcm condensed normal depth=${depth}]`,
			`parents=${parents.length} parent_tokens=${totalTokens}`,
			...parents.slice(0, 4).map((parent) => `- ${normalizeText(parent.content, 160)}`),
		].join("\n");
	} else if (strategy === "aggressive") {
		content = [
			`[lcm condensed aggressive depth=${depth}]`,
			`parents=${parents.length}`,
			...parents.slice(0, 3).map((parent) => `- ${normalizeText(parent.content, 70)}`),
		].join("\n");
	} else {
		content = [
			`[lcm condensed fallback depth=${depth}]`,
			`parents=${parents.length}`,
			`ids=${parents.map((parent) => parent.summaryId).join(",")}`,
		].join("\n");
	}

	const summaryId = makeSummaryId(
		conversationId,
		"condensed",
		depth,
		strategy,
		parents.map((parent) => parent.summaryId),
	);
	return {
		summaryId,
		depth,
		kind: "condensed",
		content,
		tokenEstimate: estimateTokens(content),
		createdAt,
		earliestAt,
		latestAt,
	};
}

function runLeafPass(store: LcmStore, strategy: CompactionStrategy, options: RunLcmCompactionOptions): boolean {
	const items = store.listContextItems(options.conversationId);
	const evictable = getEvictableItems(items, options.freshTailCount);
	if (evictable.length === 0) {
		return false;
	}

	const run: ContextItemRecord[] = [];
	for (const item of evictable) {
		if (item.itemType === "message") {
			run.push(item);
			continue;
		}
		if (run.length > 0) {
			break;
		}
	}
	if (run.length === 0) {
		return false;
	}

	const chunk: ContextItemRecord[] = [];
	let tokenSum = 0;
	for (const item of run) {
		chunk.push(item);
		tokenSum += item.tokenEstimate;
		if (tokenSum >= options.leafChunkTokens) {
			break;
		}
	}

	const messageIds = chunk.map((item) => item.messageId).filter((id): id is number => typeof id === "number");
	if (messageIds.length === 0) {
		return false;
	}
	const messages = store.getMessagesByIds(messageIds);
	if (messages.length === 0) {
		return false;
	}

	const summary = buildLeafSummary(options.conversationId, messages, strategy);
	const startOrdinal = chunk[0].ordinal;
	const endOrdinal = chunk[chunk.length - 1].ordinal;

	store.inTransaction(() => {
		store.upsertSummary({
			summaryId: summary.summaryId,
			conversationId: options.conversationId,
			depth: summary.depth,
			kind: summary.kind,
			content: summary.content,
			tokenEstimate: summary.tokenEstimate,
			earliestAt: summary.earliestAt,
			latestAt: summary.latestAt,
			createdAt: summary.createdAt,
		});
		store.setSummaryMessages(summary.summaryId, messageIds);
		store.setSummaryParents(summary.summaryId, []);
		replaceRangeWithSummary(
			store,
			options.conversationId,
			startOrdinal,
			endOrdinal,
			summary.summaryId,
			summary.createdAt,
		);
	});

	return true;
}

function findCondensableRun(items: ContextItemRecord[]): ContextItemRecord[] {
	let run: ContextItemRecord[] = [];
	let depth: number | null = null;

	for (const item of items) {
		if (item.itemType !== "summary" || !item.summaryId || item.summaryDepth === null) {
			if (run.length >= 2) {
				return run;
			}
			run = [];
			depth = null;
			continue;
		}

		if (depth === null || depth !== item.summaryDepth) {
			if (run.length >= 2) {
				return run;
			}
			run = [item];
			depth = item.summaryDepth;
			continue;
		}

		run.push(item);
		if (run.length >= MAX_FANOUT) {
			return run;
		}
	}

	return run.length >= 2 ? run : [];
}

function runCondensedPass(store: LcmStore, strategy: CompactionStrategy, options: RunLcmCompactionOptions): boolean {
	const items = store.listContextItems(options.conversationId);
	const evictable = getEvictableItems(items, options.freshTailCount);
	if (evictable.length < 2) {
		return false;
	}
	const run = findCondensableRun(evictable);
	if (run.length < 2) {
		return false;
	}

	const baseDepth = run[0].summaryDepth;
	if (baseDepth === null) {
		return false;
	}
	const nextDepth = baseDepth + 1;
	if (nextDepth > options.incrementalMaxDepth) {
		return false;
	}

	const parentIds = run.map((item) => item.summaryId).filter((id): id is string => typeof id === "string");
	if (parentIds.length < 2) {
		return false;
	}

	const parents = store.getSummaryRows(parentIds);
	if (parents.length < 2) {
		return false;
	}

	const summary = buildCondensedSummary(options.conversationId, nextDepth, strategy, parents);
	const startOrdinal = run[0].ordinal;
	const endOrdinal = run[run.length - 1].ordinal;

	store.inTransaction(() => {
		store.upsertSummary({
			summaryId: summary.summaryId,
			conversationId: options.conversationId,
			depth: summary.depth,
			kind: summary.kind,
			content: summary.content,
			tokenEstimate: summary.tokenEstimate,
			earliestAt: summary.earliestAt,
			latestAt: summary.latestAt,
			createdAt: summary.createdAt,
		});
		store.setSummaryMessages(summary.summaryId, []);
		store.setSummaryParents(summary.summaryId, parentIds);
		replaceRangeWithSummary(
			store,
			options.conversationId,
			startOrdinal,
			endOrdinal,
			summary.summaryId,
			summary.createdAt,
		);
	});

	return true;
}

export function runLcmCompaction(
	store: LcmStore,
	options: RunLcmCompactionOptions,
): RunLcmCompactionResult {
	const initialTokens = store.getContextTokenEstimate(options.conversationId);
	if (initialTokens <= options.targetTokens) {
		return {
			compacted: false,
			initialTokens,
			finalTokens: initialTokens,
			createdLeafCount: 0,
			createdCondensedCount: 0,
			strategyUsed: null,
		};
	}

	let createdLeafCount = 0;
	let createdCondensedCount = 0;
	let strategyUsed: CompactionStrategy | null = null;

	for (const strategy of STRATEGIES) {
		let anyStrategyProgress = false;
		for (let pass = 0; pass < MAX_PASSES_PER_STRATEGY; pass += 1) {
			if (store.getContextTokenEstimate(options.conversationId) <= options.targetTokens) {
				break;
			}

			let changed = false;
			if (runLeafPass(store, strategy, options)) {
				createdLeafCount += 1;
				changed = true;
				anyStrategyProgress = true;
			}

			if (store.getContextTokenEstimate(options.conversationId) <= options.targetTokens) {
				break;
			}

			if (runCondensedPass(store, strategy, options)) {
				createdCondensedCount += 1;
				changed = true;
				anyStrategyProgress = true;
			}

			if (!changed) {
				break;
			}
		}

		if (anyStrategyProgress) {
			strategyUsed = strategy;
		}
		if (store.getContextTokenEstimate(options.conversationId) <= options.targetTokens) {
			break;
		}
	}

	const finalTokens = store.getContextTokenEstimate(options.conversationId);
	return {
		compacted: finalTokens < initialTokens,
		initialTokens,
		finalTokens,
		createdLeafCount,
		createdCondensedCount,
		strategyUsed,
	};
}
