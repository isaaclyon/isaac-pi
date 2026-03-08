import type { AgentMessage, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { streamSimple } from "@mariozechner/pi-ai";
import { assembleContext } from "./assembly.ts";
import { runLcmCompaction } from "./compaction.ts";
import { resolveLcmConfig, type LcmConfig } from "./config.ts";
import { closeAllLcmDbs, getLcmDb } from "./db.ts";
import { createLlmSummarizer } from "./summarizer.ts";
import { registerLcmRetrievalTools } from "./retrieval-tools.ts";
import { LcmStore } from "./store.ts";
import { toStoredFromEntry, toStoredMessage, type SessionMessageEntryLike } from "./types.ts";

type RuntimeState = {
	enabled: boolean;
	config: LcmConfig;
	store?: LcmStore;
	conversationId?: number;
	conversationKey?: string;
	compactionInFlight: boolean;
};

function buildConversationIdentity(ctx: {
	cwd: string;
	sessionManager: { getSessionFile(): string | undefined };
}): { conversationKey: string; sessionFile: string | null; cwd: string } {
	const sessionFile = ctx.sessionManager.getSessionFile() ?? null;
	const conversationKey = sessionFile ? `${ctx.cwd}::${sessionFile}` : `${ctx.cwd}::in-memory`;
	return {
		conversationKey,
		sessionFile,
		cwd: ctx.cwd,
	};
}

function getMessageEntryId(ctx: {
	sessionManager: {
		getLeafEntry(): { type?: string; id?: string } | undefined;
	};
}): string | null {
	const entry = ctx.sessionManager.getLeafEntry();
	if (!entry || entry.type !== "message") {
		return null;
	}
	if (typeof entry.id !== "string" || !entry.id.trim()) {
		return null;
	}
	return entry.id;
}

function extractBranchMessages(ctx: {
	sessionManager: {
		getBranch(): Array<{ type: string; id: string; message?: AgentMessage }>;
	};
}): SessionMessageEntryLike[] {
	const branch = ctx.sessionManager.getBranch();
	const out: SessionMessageEntryLike[] = [];
	for (const entry of branch) {
		if (entry.type !== "message") {
			continue;
		}
		if (!entry.message) {
			continue;
		}
		out.push(entry as unknown as SessionMessageEntryLike);
	}
	return out;
}

function bootstrapFromBranch(
	state: RuntimeState,
	ctx: {
		sessionManager: {
			getBranch(): Array<{ type: string; id: string; message?: AgentMessage }>;
		};
		hasUI: boolean;
		ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
	},
): void {
	if (!state.enabled || !state.store || typeof state.conversationId !== "number") {
		return;
	}

	const messages = extractBranchMessages(ctx).map(toStoredFromEntry);
	const inserted = state.store.insertMessagesBatch(state.conversationId, messages);

	if (ctx.hasUI && inserted > 0) {
		ctx.ui.notify(`[lcm] bootstrapped ${inserted} message(s) into SQLite`, "info");
	}
}

function setupConversation(
	state: RuntimeState,
	ctx: {
		cwd: string;
		sessionManager: { getSessionFile(): string | undefined };
		hasUI: boolean;
		ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
	},
): void {
	if (!state.enabled || !state.store) {
		return;
	}

	const identity = buildConversationIdentity(ctx);
	const conversation = state.store.getOrCreateConversation(identity);
	state.conversationId = conversation.conversationId;
	state.conversationKey = conversation.conversationKey;

	if (ctx.hasUI) {
		ctx.ui.notify(`[lcm] active conversation ${conversation.conversationId}`, "info");
	}
}

export default function lcmExtension(pi: ExtensionAPI): void {
	const state: RuntimeState = {
		enabled: false,
		config: resolveLcmConfig(process.cwd()),
		compactionInFlight: false,
	};

	registerLcmRetrievalTools(pi, () => ({
		enabled: state.enabled,
		store: state.store,
		conversationId: state.conversationId,
	}));

	pi.on("session_start", (event, ctx) => {
		void event;
		const config = resolveLcmConfig(ctx.cwd);
		state.config = config;
		state.enabled = config.enabled;
		if (!config.enabled) {
			state.store = undefined;
			state.conversationId = undefined;
			state.conversationKey = undefined;
			state.compactionInFlight = false;
			return;
		}

		const db = getLcmDb(config.dbPath);
		state.store = new LcmStore(db);
		setupConversation(state, ctx);
		bootstrapFromBranch(state, ctx);
	});

	pi.on("session_switch", (event, ctx) => {
		void event;
		if (!state.enabled || !state.store) {
			return;
		}
		setupConversation(state, ctx);
		bootstrapFromBranch(state, ctx);
	});

	pi.on("message_end", (event, ctx) => {
		if (!state.enabled || !state.store || typeof state.conversationId !== "number") {
			return;
		}

		const entryId = getMessageEntryId(ctx);
		const stored = toStoredMessage(event.message, entryId);
		const result = state.store.insertMessage(state.conversationId, stored);
		if (!result.inserted) {
			return;
		}

		if (ctx.hasUI) {
			ctx.ui.setStatus("lcm", `LCM stored: ${stored.role}`);
		}
	});

	pi.on("context", (_event, _ctx) => {
		if (!state.enabled || !state.store || typeof state.conversationId !== "number") {
			// LCM disabled or not yet initialised — leave native context intact
			return {};
		}
		try {
			const messages = assembleContext(state.store, state.conversationId);
			if (messages.length === 0) {
				// No LCM context built yet (no context_items) — defer to native
				return {};
			}
			return { messages };
		} catch {
			// Fail-open: any assembly error leaves native context intact
			return {};
		}
	});

	pi.on("turn_end", (event, ctx) => {
		void event;
		if (!state.enabled || !state.store || typeof state.conversationId !== "number") {
			return;
		}
		if (state.compactionInFlight) {
			return;
		}

		const usage = ctx.getContextUsage();
		if (!usage || usage.percent === null || usage.contextWindow <= 0) {
			return;
		}
		if (usage.percent < state.config.contextThreshold) {
			return;
		}

		const targetTokens = Math.max(1, Math.floor(usage.contextWindow * state.config.contextThreshold));
		const model = ctx.model;
		state.compactionInFlight = true;
		// Fire-and-forget: do not await on the turn_end critical path.
		// compactionInFlight is cleared in the finally block of the async chain.
		runLcmCompaction(state.store, {
			conversationId: state.conversationId,
			targetTokens,
			freshTailCount: state.config.freshTailCount,
			leafChunkTokens: state.config.leafChunkTokens,
			incrementalMaxDepth: state.config.incrementalMaxDepth,
			summarizer: model ? createLlmSummarizer(streamSimple, model) : undefined,
		})
			.then((result) => {
				if (ctx.hasUI && result.compacted) {
					ctx.ui.notify(
						`[lcm] compacted ${result.initialTokens} -> ${result.finalTokens} (leaf=${result.createdLeafCount}, condensed=${result.createdCondensedCount}, strategy=${result.strategyUsed ?? "n/a"})`,
						"info",
					);
				}
			})
			.catch((error) => {
				if (ctx.hasUI) {
					const message = error instanceof Error ? error.message : String(error);
					ctx.ui.notify(`[lcm] compaction error (non-fatal): ${message}`, "warning");
				}
			})
			.finally(() => {
				state.compactionInFlight = false;
			});
	});

	pi.on("session_shutdown", (_event, _ctx) => {
		// Close all SQLite connections on process exit so WAL is checkpointed cleanly.
		closeAllLcmDbs();
	});
}
