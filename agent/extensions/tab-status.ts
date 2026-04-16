/**
 * Update the terminal tab title with Pi run status (:new/:🔄/:✅/:🚧/:🛑).
 * Based on @tmustier/pi-tab-status, with custom emoji.
 */
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
	SessionSwitchEvent,
	BeforeAgentStartEvent,
	AgentStartEvent,
	AgentEndEvent,
	TurnStartEvent,
	ToolCallEvent,
	ToolResultEvent,
	SessionShutdownEvent,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { complete, type Api, type AssistantMessage, type Model, type StopReason, type UserMessage } from "@mariozechner/pi-ai";
import { basename } from "node:path";

type StatusState = "new" | "running" | "doneCommitted" | "doneNoCommit" | "timeout";

type StatusTracker = {
	state: StatusState;
	running: boolean;
	sawCommit: boolean;
};

type ModelAuthResult =
	| {
			ok: true;
			apiKey?: string;
			headers?: Record<string, string>;
	  }
	| {
			ok: false;
			error: string;
	  };

export type ConversationPair = {
	user: string;
	assistant: string;
};

const STATUS_TEXT: Record<StatusState, string> = {
	new: ": 🆕",
	running: ": 🔄",
	doneCommitted: ": ✅",
	doneNoCommit: ": 🚧",
	timeout: ": 🛑",
};

const INACTIVE_TIMEOUT_MS = 180_000;
const FALLBACK_REFRESH_MS = 5 * 60_000;
const GIT_COMMIT_RE = /\bgit\b[^\n]*\bcommit\b/;
const MAX_FALLBACK_WORDS = 5;
const MAX_SUMMARY_WORDS = 4;
const MAX_LABEL_LENGTH = 36;
const SUMMARY_PROVIDER = "openai-codex";
const SUMMARY_MODEL_ID = "gpt-5.4-mini";
const SUMMARY_INTERVAL_PAIRS = 4;
const SUMMARY_WINDOW_PAIRS = 2;
const SUMMARY_MESSAGE_MAX_CHARS = 220;
const SUMMARY_MAX_TOKENS = 48;
const SUMMARY_SYSTEM_PROMPT = `You generate short terminal tab labels for coding sessions.
Return exactly one minified JSON object with this schema:
{"label":"string"}
Rules:
- The label must be plain text only.
- The label must be 1 to 4 words.
- No emoji.
- No surrounding commentary.
- No trailing punctuation.
- Prefer a stable, concrete description of the session.
- Use the opening exchanges for enduring context and the recent exchanges for the current focus.
- If they diverge, prefer the recent dominant task.
`;

const clip = (text: string): string => {
	const normalized = text.trim();
	if (normalized.length <= MAX_LABEL_LENGTH) return normalized;
	return `${normalized.slice(0, MAX_LABEL_LENGTH - 1).trimEnd()}…`;
};

const clipSummaryMessage = (text: string): string => {
	const normalized = text.trim();
	if (normalized.length <= SUMMARY_MESSAGE_MAX_CHARS) return normalized;
	return `${normalized.slice(0, SUMMARY_MESSAGE_MAX_CHARS - 3).trimEnd()}...`;
};

const normalizeManualLabel = (text: string): string => {
	return clip(text.replace(/\s+/g, " ").trim());
};

const normalizeLabel = (text: string, maxWords: number): string => {
	const normalized = text
		.replace(/["'`]/g, "")
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.replace(/[.!?,;:]+$/g, "")
		.trim();
	if (!normalized) return "";
	return clip(normalized.split(" ").slice(0, maxWords).join(" "));
};

const promptToSlug = (prompt: string): string => {
	const cleaned = prompt
		.replace(/```[\s\S]*?```/g, " ")
		.replace(/`[^`]*`/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	if (!cleaned) return "";
	return normalizeLabel(cleaned, MAX_FALLBACK_WORDS);
};

export const getMessageText = (message: AgentMessage): string => {
	if (!message || typeof message !== "object") return "";
	const maybeMessage = message as { role?: string; content?: unknown };
	if (maybeMessage.role !== "user" && maybeMessage.role !== "assistant") return "";
	const { content } = maybeMessage;
	if (typeof content === "string") {
		return content.replace(/\s+/g, " ").trim();
	}
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => {
			if (!part || typeof part !== "object") return "";
			const maybePart = part as { type?: string; text?: unknown };
			return maybePart.type === "text" && typeof maybePart.text === "string" ? maybePart.text : "";
		})
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();
};

export const getUserPromptFromMessage = (message: AgentMessage): string | undefined => {
	if (!message || typeof message !== "object") return undefined;
	const maybeMessage = message as { role?: string };
	if (maybeMessage.role !== "user") return undefined;
	const text = getMessageText(message);
	return text || undefined;
};

export const extractConversationPairs = (messages: AgentMessage[]): ConversationPair[] => {
	const pairs: ConversationPair[] = [];
	const pendingUserMessages: string[] = [];

	for (const message of messages) {
		const text = clipSummaryMessage(getMessageText(message));
		if (!text) continue;

		if (message.role === "user") {
			pendingUserMessages.push(text);
			continue;
		}

		if (message.role !== "assistant" || pendingUserMessages.length === 0) {
			continue;
		}

		pairs.push({
			user: pendingUserMessages.join("\n"),
			assistant: text,
		});
		pendingUserMessages.length = 0;
	}

	return pairs;
};

const formatPairs = (pairs: ConversationPair[], startIndex: number): string => {
	return pairs
		.map(
			(pair, index) =>
				`${startIndex + index + 1}. User: ${pair.user}\n   Assistant: ${pair.assistant}`,
		)
		.join("\n\n");
};

export const buildSessionSummaryInput = (messages: AgentMessage[]): string => {
	const pairs = extractConversationPairs(messages);
	if (pairs.length === 0) return "";

	if (pairs.length <= SUMMARY_WINDOW_PAIRS * 2) {
		return [
			`Completed exchange pairs: ${pairs.length}`,
			"Session exchange pairs:",
			formatPairs(pairs, 0),
		].join("\n");
	}

	const openingPairs = pairs.slice(0, SUMMARY_WINDOW_PAIRS);
	const recentStartIndex = pairs.length - SUMMARY_WINDOW_PAIRS;
	const recentPairs = pairs.slice(recentStartIndex);

	return [
		`Completed exchange pairs: ${pairs.length}`,
		`Opening session pairs (first ${openingPairs.length}):`,
		formatPairs(openingPairs, 0),
		"",
		`Recent session pairs (last ${recentPairs.length}):`,
		formatPairs(recentPairs, recentStartIndex),
	].join("\n");
};

export const getSummaryThresholdToEvaluate = (
	pairCount: number,
	lastEvaluatedPairCount: number,
): number | null => {
	if (pairCount < SUMMARY_INTERVAL_PAIRS) return null;
	const nextThreshold = Math.floor(pairCount / SUMMARY_INTERVAL_PAIRS) * SUMMARY_INTERVAL_PAIRS;
	return nextThreshold > lastEvaluatedPairCount ? nextThreshold : null;
};

export const parseStructuredSessionLabel = (text: string): string => {
	const normalized = text.trim();
	if (!normalized) return "";

	let parsed: unknown;
	try {
		parsed = JSON.parse(normalized);
	} catch {
		return "";
	}

	if (!parsed || typeof parsed !== "object") return "";
	const maybeLabel = (parsed as { label?: unknown }).label;
	if (typeof maybeLabel !== "string") return "";
	return normalizeLabel(maybeLabel, MAX_SUMMARY_WORDS);
};

export default function (pi: ExtensionAPI) {
	const status: StatusTracker = {
		state: "new",
		running: false,
		sawCommit: false,
	};
	let timeoutId: ReturnType<typeof setTimeout> | undefined;
	let fallbackRefreshId: ReturnType<typeof setTimeout> | undefined;
	const nativeClearTimeout = globalThis.clearTimeout;
	let workLabel = "pi";
	let runId = 0;
	let lastSummaryPairThreshold = 0;
	let summaryHintShown = false;
	let labelMode: "fallback" | "manual" | "summary" = "fallback";
	let lastRenderedLabel: string | undefined;

	const cwdBase = (ctx: ExtensionContext): string => basename(ctx.cwd || "pi");

	const getSessionNameLabel = (ctx: ExtensionContext): string | undefined => {
		const name = ctx.sessionManager.getSessionName();
		if (!name) return undefined;
		const normalized = name.trim();
		return normalized ? clip(normalized) : undefined;
	};

	const getLatestPromptFromBranch = (ctx: ExtensionContext): string | undefined => {
		const branch = ctx.sessionManager.getBranch();
		for (let i = branch.length - 1; i >= 0; i -= 1) {
			const entry = branch[i];
			if (entry.type !== "message") continue;
			const prompt = getUserPromptFromMessage(entry.message);
			if (prompt) return prompt;
		}
		return undefined;
	};

	const refreshWorkLabel = (ctx: ExtensionContext, prompt?: string, options?: { force?: boolean }): void => {
		const sessionName = getSessionNameLabel(ctx);
		if (sessionName) {
			workLabel = sessionName;
			labelMode = "fallback";
			return;
		}
		if ((labelMode === "manual" || labelMode === "summary") && !options?.force) {
			return;
		}
		const source = prompt || getLatestPromptFromBranch(ctx);
		const slug = source ? promptToSlug(source) : "";
		workLabel = slug || cwdBase(ctx);
		labelMode = "fallback";
	};

	const displayLabel = (ctx: ExtensionContext): string => {
		const sessionName = getSessionNameLabel(ctx);
		if (sessionName) return sessionName;
		return workLabel || cwdBase(ctx);
	};

	const getBranchMessages = (ctx: ExtensionContext): AgentMessage[] => {
		const branch = ctx.sessionManager.getBranch();
		const messages: AgentMessage[] = [];
		for (const entry of branch) {
			if (entry.type !== "message") continue;
			messages.push(entry.message);
		}
		return messages;
	};

	const selectSummaryModel = (ctx: ExtensionContext): Model<Api> | undefined => {
		const exact = ctx.modelRegistry.find(SUMMARY_PROVIDER, SUMMARY_MODEL_ID) as Model<Api> | undefined;
		if (exact) return exact;
		const available = ctx.modelRegistry.getAvailable();
		const miniLike = available.find(
			(model) => model.provider === SUMMARY_PROVIDER && model.id.toLowerCase().includes(SUMMARY_MODEL_ID),
		) as Model<Api> | undefined;
		if (miniLike) return miniLike;
		if (ctx.model?.provider === SUMMARY_PROVIDER && ctx.model.id.toLowerCase().includes(SUMMARY_MODEL_ID)) {
			return ctx.model as Model<Api>;
		}
		return undefined;
	};

	const clearFallbackRefresh = (): void => {
		if (fallbackRefreshId === undefined) return;
		nativeClearTimeout(fallbackRefreshId);
		fallbackRefreshId = undefined;
	};

	const resolveModelAuth = async (ctx: ExtensionContext, model: Model<Api>): Promise<ModelAuthResult> => {
		const maybeModelRegistry = ctx.modelRegistry as {
			getApiKeyAndHeaders?: (selectedModel: Model<Api>) => Promise<ModelAuthResult>;
		};
		if (typeof maybeModelRegistry.getApiKeyAndHeaders !== "function") {
			return { ok: false, error: "model-registry-auth-unavailable" };
		}
		return maybeModelRegistry.getApiKeyAndHeaders(model);
	};

	const resetFallbackRefreshTimer = (ctx: ExtensionContext): void => {
		clearFallbackRefresh();
		if (!ctx.hasUI) return;
		fallbackRefreshId = setTimeout(() => {
			const previousLabel = displayLabel(ctx);
			refreshWorkLabel(ctx);
			const nextLabel = displayLabel(ctx);
			if (nextLabel === previousLabel) {
				resetFallbackRefreshTimer(ctx);
				return;
			}
			setTitle(ctx, status.state);
		}, FALLBACK_REFRESH_MS);
	};

	const setTitle = (ctx: ExtensionContext, next: StatusState): void => {
		status.state = next;
		const nextLabel = displayLabel(ctx);
		const labelChanged = nextLabel !== lastRenderedLabel;
		lastRenderedLabel = nextLabel;
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(`${nextLabel}${STATUS_TEXT[next]}`);
		if (labelChanged) {
			resetFallbackRefreshTimer(ctx);
		}
	};

	const summarizeWorkLabel = async (
		ctx: ExtensionContext,
		messages: AgentMessage[],
		runIdSnapshot: number,
		stateAfterSummary: StatusState,
	): Promise<{ attempted: boolean; updated: boolean; reason: string }> => {
		if (!ctx.hasUI) return { attempted: false, updated: false, reason: "no-ui" };
		if (status.running) return { attempted: false, updated: false, reason: "running" };
		if (getSessionNameLabel(ctx)) return { attempted: false, updated: false, reason: "session-name-set" };
		const model = selectSummaryModel(ctx);
		if (!model) return { attempted: false, updated: false, reason: "no-model" };
		const auth = await resolveModelAuth(ctx, model);
		if (!auth.ok) return { attempted: false, updated: false, reason: auth.error };
		if (!auth.apiKey) return { attempted: false, updated: false, reason: "no-api-key" };
		const input = buildSessionSummaryInput(messages);
		if (!input.trim()) return { attempted: false, updated: false, reason: "no-input" };

		let response: AssistantMessage;
		try {
			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: input }],
				timestamp: Date.now(),
			};
			response = await complete(
				model,
				{ systemPrompt: SUMMARY_SYSTEM_PROMPT, messages: [userMessage] },
				{
					apiKey: auth.apiKey,
					headers: auth.headers,
					maxTokens: SUMMARY_MAX_TOKENS,
					reasoningEffort: "low",
				},
			);
		} catch {
			return { attempted: true, updated: false, reason: "request-failed" };
		}

		if (runIdSnapshot !== runId || status.running) return { attempted: true, updated: false, reason: "stale" };
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			const detail = normalizeLabel(response.errorMessage || "", MAX_SUMMARY_WORDS) || response.stopReason;
			return { attempted: true, updated: false, reason: `bad-stop-reason (${detail})` };
		}
		const generated = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		const nextLabel = parseStructuredSessionLabel(generated);
		if (!nextLabel) return { attempted: true, updated: false, reason: "invalid-label" };
		labelMode = "summary";
		if (nextLabel === workLabel) return { attempted: true, updated: false, reason: "unchanged" };
		workLabel = nextLabel;
		setTitle(ctx, stateAfterSummary);
		return { attempted: true, updated: true, reason: "updated" };
	};

	const maybeSummarizeTitle = async (
		ctx: ExtensionContext,
		runIdSnapshot: number,
		stateAfterSummary: StatusState,
	): Promise<{ attempted: boolean; updated: boolean; reason: string }> => {
		const messages = getBranchMessages(ctx);
		const pairCount = extractConversationPairs(messages).length;
		const threshold = getSummaryThresholdToEvaluate(pairCount, lastSummaryPairThreshold);
		if (threshold === null) {
			if (pairCount < SUMMARY_INTERVAL_PAIRS) {
				return {
					attempted: false,
					updated: false,
					reason: `pairs-${pairCount}-lt-${SUMMARY_INTERVAL_PAIRS}`,
				};
			}
			return { attempted: false, updated: false, reason: "threshold-already-evaluated" };
		}

		lastSummaryPairThreshold = threshold;
		return summarizeWorkLabel(ctx, messages, runIdSnapshot, stateAfterSummary);
	};

	const clearTabTimeout = (): void => {
		if (timeoutId === undefined) return;
		nativeClearTimeout(timeoutId);
		timeoutId = undefined;
	};

	const resetTimeout = (ctx: ExtensionContext): void => {
		clearTabTimeout();
		timeoutId = setTimeout(() => {
			if (status.running && status.state === "running") {
				setTitle(ctx, "timeout");
			}
		}, INACTIVE_TIMEOUT_MS);
	};

	const markActivity = (ctx: ExtensionContext): void => {
		if (status.state === "timeout") {
			setTitle(ctx, "running");
		}
		if (!status.running) return;
		resetTimeout(ctx);
	};

	const resetState = (ctx: ExtensionContext, next: StatusState): void => {
		status.running = false;
		status.sawCommit = false;
		clearTabTimeout();
		setTitle(ctx, next);
	};

	const beginRun = (ctx: ExtensionContext): void => {
		runId += 1;
		status.running = true;
		status.sawCommit = false;
		setTitle(ctx, "running");
		resetTimeout(ctx);
	};

	const getStopReason = (messages: AgentMessage[]): StopReason | undefined => {
		for (let i = messages.length - 1; i >= 0; i -= 1) {
			const message = messages[i];
			if (message.role === "assistant") {
				return (message as AssistantMessage).stopReason;
			}
		}
		return undefined;
	};

	pi.registerCommand("rename-tab", {
		description: "Temporarily rename the current tab until automatic retitling runs again",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("rename-tab requires interactive mode", "error");
				return;
			}

			const nextLabel = normalizeManualLabel(args);
			if (!nextLabel) {
				ctx.ui.notify("Usage: /rename-tab <new tab label>", "error");
				return;
			}

			workLabel = nextLabel;
			labelMode = "manual";
			setTitle(ctx, status.state);
		},
	});

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		lastSummaryPairThreshold = 0;
		summaryHintShown = false;
		refreshWorkLabel(ctx, undefined, { force: true });
		resetState(ctx, "new");
		clearFallbackRefresh();
		resetFallbackRefreshTimer(ctx);
	});

	pi.on("session_switch", async (event: SessionSwitchEvent, ctx: ExtensionContext) => {
		lastSummaryPairThreshold = 0;
		summaryHintShown = false;
		refreshWorkLabel(ctx, undefined, { force: true });
		resetState(ctx, event.reason === "new" ? "new" : "doneCommitted");
		clearFallbackRefresh();
		resetFallbackRefreshTimer(ctx);
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		refreshWorkLabel(ctx, event.prompt);
		markActivity(ctx);
	});

	pi.on("agent_start", async (_event: AgentStartEvent, ctx: ExtensionContext) => {
		beginRun(ctx);
	});

	pi.on("turn_start", async (_event: TurnStartEvent, ctx: ExtensionContext) => {
		markActivity(ctx);
	});

	pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
		if (event.toolName === "bash") {
			const command = typeof event.input.command === "string" ? event.input.command : "";
			if (command && GIT_COMMIT_RE.test(command)) {
				status.sawCommit = true;
			}
		}
		markActivity(ctx);
	});

	pi.on("tool_result", async (_event: ToolResultEvent, ctx: ExtensionContext) => {
		markActivity(ctx);
	});

	pi.on("agent_end", async (event: AgentEndEvent, ctx: ExtensionContext) => {
		status.running = false;
		clearTabTimeout();
		const completedRunId = runId;
		const stopReason = getStopReason(event.messages);
		if (stopReason === "error") {
			setTitle(ctx, "timeout");
			return;
		}
		const finalState: StatusState = status.sawCommit ? "doneCommitted" : "doneNoCommit";
		setTitle(ctx, finalState);
		void maybeSummarizeTitle(ctx, completedRunId, finalState)
			.then((result) => {
				if (!ctx.hasUI || result.updated || summaryHintShown) return;
				if (result.reason !== "no-model" && result.reason !== "no-api-key") return;
				summaryHintShown = true;
				ctx.ui.notify(`Tab summarizer unavailable (${result.reason}). Try again after /login.`, "warning");
			})
			.catch(() => {
				// Best-effort only: keep existing label if summarization fails.
			});
	});

	pi.on("session_shutdown", async (_event: SessionShutdownEvent, ctx: ExtensionContext) => {
		clearTabTimeout();
		clearFallbackRefresh();
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(displayLabel(ctx));
	});
}
