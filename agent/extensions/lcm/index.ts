import type { AgentMessage, ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { getLcmDb } from "./db.js";
import { resolveLcmConfig } from "./config.js";
import { LcmStore } from "./store.js";
import { toStoredFromEntry, toStoredMessage, type SessionMessageEntryLike } from "./types.js";

type RuntimeState = {
	enabled: boolean;
	store?: LcmStore;
	conversationId?: number;
	conversationKey?: string;
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

function bootstrapFromBranch(state: RuntimeState, ctx: {
	sessionManager: {
		getBranch(): Array<{ type: string; id: string; message?: AgentMessage }>;
	};
	hasUI: boolean;
	ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}): void {
	if (!state.enabled || !state.store || typeof state.conversationId !== "number") {
		return;
	}

	const messages = extractBranchMessages(ctx).map(toStoredFromEntry);
	const inserted = state.store.insertMessagesBatch(state.conversationId, messages);

	if (ctx.hasUI && inserted > 0) {
		ctx.ui.notify(`[lcm] bootstrapped ${inserted} message(s) into SQLite`, "info");
	}
}

function setupConversation(state: RuntimeState, ctx: {
	cwd: string;
	sessionManager: { getSessionFile(): string | undefined };
	hasUI: boolean;
	ui: { notify(message: string, type?: "info" | "warning" | "error"): void };
}): void {
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
	};

	pi.on("session_start", (event, ctx) => {
		void event;
		const config = resolveLcmConfig(ctx.cwd);
		state.enabled = config.enabled;
		if (!config.enabled) {
			state.store = undefined;
			state.conversationId = undefined;
			state.conversationKey = undefined;
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
}
