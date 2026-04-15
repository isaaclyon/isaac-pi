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
const MAX_TOPIC_WORDS = 5;
const MAX_TOPIC_LENGTH = 36;
const TITLE_REROLL_PROVIDER = "openai-codex";
const TITLE_REROLL_MODEL_ID = "gpt-5.3-codex-spark";
const TITLE_REROLL_USER_MESSAGES = 5;
const TITLE_REROLL_DIFF_FILES = 15;
const TITLE_REROLL_DIFF_DELTA_THRESHOLD = 25;
const TITLE_REROLL_STICKY_PROMPTS = 4;
const MAX_DIFF_SUMMARY_CHARS = 1200;
const TITLE_REROLL_SYSTEM_PROMPT = `You generate short terminal tab labels for coding sessions.
Return only the label text.
Rules:
- Max 5 words.
- Plain text only.
- No surrounding quotes.
- No emoji.
- No trailing punctuation.
- Prefer the most concrete current coding task.
- Use the provided user prompts and git diff summary.
`;

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
	let promptCount = 0;
	let promptsSinceReroll = 0;
	let lastRerollDiffLines: number | null = null;
	let rerollHintShown = false;
	let labelMode: "fallback" | "reroll" = "fallback";
	let lastRenderedLabel: string | undefined;


	const cwdBase = (ctx: ExtensionContext): string => basename(ctx.cwd || "pi");

	const clip = (text: string): string => {
		const normalized = text.trim();
		if (normalized.length <= MAX_TOPIC_LENGTH) return normalized;
		return `${normalized.slice(0, MAX_TOPIC_LENGTH - 1).trimEnd()}…`;
	};

	const promptToSlug = (prompt: string): string => {
		const cleaned = prompt
			.replace(/```[\s\S]*?```/g, " ")
			.replace(/`[^`]*`/g, " ")
			.replace(/\s+/g, " ")
			.trim();
		if (!cleaned) return "";
		return clip(cleaned.split(" ").slice(0, MAX_TOPIC_WORDS).join(" "));
	};

	const getSessionNameLabel = (ctx: ExtensionContext): string | undefined => {
		const name = ctx.sessionManager.getSessionName();
		if (!name) return undefined;
		const normalized = name.trim();
		return normalized ? clip(normalized) : undefined;
	};

	const getUserPromptFromMessage = (message: AgentMessage): string | undefined => {
		if (!message || typeof message !== "object") return undefined;
		const maybeMessage = message as { role?: string; content?: unknown };
		if (maybeMessage.role !== "user") return undefined;
		const { content } = maybeMessage;
		if (typeof content === "string") {
			const normalized = content.trim();
			return normalized || undefined;
		}
		if (!Array.isArray(content)) return undefined;
		const text = content
			.map((part) => {
				if (!part || typeof part !== "object") return "";
				const maybePart = part as { type?: string; text?: unknown };
				return maybePart.type === "text" && typeof maybePart.text === "string" ? maybePart.text : "";
			})
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		return text || undefined;
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
		if (labelMode === "reroll" && !options?.force) {
			if (promptsSinceReroll < TITLE_REROLL_STICKY_PROMPTS) {
				return;
			}
			labelMode = "fallback";
		}
		const sessionName = getSessionNameLabel(ctx);
		if (sessionName) {
			workLabel = sessionName;
			labelMode = "fallback";
			promptsSinceReroll = 0;
			return;
		}
		const source = prompt || getLatestPromptFromBranch(ctx);
		const slug = source ? promptToSlug(source) : "";
		workLabel = slug || cwdBase(ctx);
		labelMode = "fallback";
		promptsSinceReroll = 0;
	};

	const displayLabel = (ctx: ExtensionContext): string => {
		const sessionName = getSessionNameLabel(ctx);
		if (sessionName) return sessionName;
		return workLabel || cwdBase(ctx);
	};

	const normalizeModelLabel = (text: string): string => {
		const normalized = text
			.replace(/[\"'`]/g, "")
			.replace(/[\r\n]+/g, " ")
			.replace(/\s+/g, " ")
			.replace(/[.!?,;:]+$/g, "")
			.trim();
		if (!normalized) return "";
		return clip(normalized);
	};

	const getMessageText = (message: AgentMessage): string => {
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

	const getBranchMessages = (ctx: ExtensionContext): AgentMessage[] => {
		const branch = ctx.sessionManager.getBranch();
		const messages: AgentMessage[] = [];
		for (const entry of branch) {
			if (entry.type !== "message") continue;
			messages.push(entry.message);
		}
		return messages;
	};

	const getRecentUserPrompts = (messages: AgentMessage[]): string[] => {
		const prompts: string[] = [];
		for (let i = messages.length - 1; i >= 0 && prompts.length < TITLE_REROLL_USER_MESSAGES; i -= 1) {
			const message = messages[i];
			if (!message || typeof message !== "object") continue;
			const maybeMessage = message as { role?: string };
			if (maybeMessage.role !== "user") continue;
			const text = getMessageText(message);
			if (!text) continue;
			const clipped = text.length > 220 ? `${text.slice(0, 217)}...` : text;
			prompts.unshift(clipped);
		}
		return prompts;
	};

	const parseNumstat = (numstat: string): { total: number; lines: string[] } => {
		const lines = numstat
			.split("\n")
			.map((line) => line.trim())
			.filter(Boolean);
		let total = 0;
		const summaryLines: string[] = [];
		for (const line of lines) {
			const parts = line.split("\t");
			if (parts.length < 3) continue;
			const [addedRaw, deletedRaw, file] = parts;
			const added = Number.parseInt(addedRaw, 10);
			const deleted = Number.parseInt(deletedRaw, 10);
			const binaryChange = Number.isNaN(added) || Number.isNaN(deleted);
			const lineDelta = binaryChange ? 10 : added + deleted;
			total += lineDelta;
			summaryLines.push(binaryChange ? `${file} (binary)` : `${file} (+${added}/-${deleted})`);
		}
		return { total, lines: summaryLines };
	};

	const getGitDiffSnapshot = async (
		ctx: ExtensionContext,
	): Promise<{ totalLines: number; summary: string; available: boolean }> => {
		const diff = await pi.exec("git", ["diff", "--numstat", "HEAD", "--"], { cwd: ctx.cwd, timeout: 5000 });
		if (diff.code !== 0) {
			return { totalLines: 0, summary: "git diff unavailable", available: false };
		}

		const parsed = parseNumstat(diff.stdout);
		const untracked = await pi.exec("git", ["ls-files", "--others", "--exclude-standard"], {
			cwd: ctx.cwd,
			timeout: 5000,
		});
		const untrackedFiles = untracked.code === 0
			? untracked.stdout
					.split("\n")
					.map((line) => line.trim())
					.filter(Boolean)
			: [];
		const untrackedLines = untrackedFiles.map((file) => `${file} (new file)`);
		const totalLines = parsed.total + untrackedFiles.length * 10;
		const diffLines = [...parsed.lines, ...untrackedLines];
		const summary = diffLines.length > 0
			? diffLines.slice(0, TITLE_REROLL_DIFF_FILES).join("\n").slice(0, MAX_DIFF_SUMMARY_CHARS)
			: "no changes";
		return { totalLines, summary, available: true };
	};

	const buildRerollInput = (messages: AgentMessage[], diffSummary: string, totalDiffLines: number): string => {
		const userPrompts = getRecentUserPrompts(messages);
		const promptBlock = userPrompts.length > 0
			? userPrompts.map((prompt, index) => `${index + 1}. ${prompt}`).join("\n")
			: "(none)";
		return [
			`Recent user prompts (last ${TITLE_REROLL_USER_MESSAGES}):`,
			promptBlock,
			"",
			`Git diff summary (total changed lines: ${totalDiffLines}):`,
			diffSummary,
		].join("\n");
	};

	const selectRerollModel = (ctx: ExtensionContext): Model<Api> | undefined => {
		const exact = ctx.modelRegistry.find(TITLE_REROLL_PROVIDER, TITLE_REROLL_MODEL_ID) as Model<Api> | undefined;
		if (exact) return exact;
		const available = ctx.modelRegistry.getAvailable();
		const sparkLike = available.find(
			(model) => model.provider === TITLE_REROLL_PROVIDER && model.id.toLowerCase().includes("codex-spark"),
		) as Model<Api> | undefined;
		if (sparkLike) return sparkLike;
		if (ctx.model?.provider === TITLE_REROLL_PROVIDER) return ctx.model as Model<Api>;
		return undefined;
	};

	const clearFallbackRefresh = (): void => {
		if (fallbackRefreshId === undefined) return;
		nativeClearTimeout(fallbackRefreshId);
		fallbackRefreshId = undefined;
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

	const rerollWorkLabel = async (
		ctx: ExtensionContext,
		messages: AgentMessage[],
		diffSummary: string,
		totalDiffLines: number,
		runIdSnapshot: number,
		stateAfterReroll: StatusState,
	): Promise<{ attempted: boolean; updated: boolean; reason: string }> => {
		if (!ctx.hasUI) return { attempted: false, updated: false, reason: "no-ui" };
		if (status.running) return { attempted: false, updated: false, reason: "running" };
		if (getSessionNameLabel(ctx)) return { attempted: false, updated: false, reason: "session-name-set" };
		const model = selectRerollModel(ctx);
		if (!model) return { attempted: false, updated: false, reason: "no-model" };
		const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
		if (!auth.ok) return { attempted: false, updated: false, reason: "no-api-key" };
		const input = buildRerollInput(messages, diffSummary, totalDiffLines);
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
				{ systemPrompt: TITLE_REROLL_SYSTEM_PROMPT, messages: [userMessage] },
				{ apiKey: auth.apiKey, headers: auth.headers, maxTokens: 32 },
			);
		} catch {
			return { attempted: true, updated: false, reason: "request-failed" };
		}

		if (runIdSnapshot !== runId || status.running) return { attempted: true, updated: false, reason: "stale" };
		if (response.stopReason === "error" || response.stopReason === "aborted") {
			const detail = normalizeModelLabel(response.errorMessage || "") || response.stopReason;
			return { attempted: true, updated: false, reason: `bad-stop-reason (${detail})` };
		}
		const generated = response.content
			.filter((part): part is { type: "text"; text: string } => part.type === "text")
			.map((part) => part.text)
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
		const nextLabel = normalizeModelLabel(generated);
		if (!nextLabel) return { attempted: true, updated: false, reason: "empty-label" };
		labelMode = "reroll";
		promptsSinceReroll = 0;
		if (nextLabel === workLabel) return { attempted: true, updated: false, reason: "unchanged" };
		workLabel = nextLabel;
		setTitle(ctx, stateAfterReroll);
		return { attempted: true, updated: true, reason: "updated" };
	};

	const maybeRerollTitle = async (
		ctx: ExtensionContext,
		runIdSnapshot: number,
		stateAfterReroll: StatusState,
		options?: { force?: boolean },
	): Promise<{ attempted: boolean; updated: boolean; reason: string }> => {
		if (!options?.force && promptCount < 1) {
			return { attempted: false, updated: false, reason: "awaiting-first-user-prompt" };
		}

		const diff = await getGitDiffSnapshot(ctx);
		const delta = lastRerollDiffLines == null ? null : Math.abs(diff.totalLines - lastRerollDiffLines);
		if (!options?.force && lastRerollDiffLines != null && delta != null && delta < TITLE_REROLL_DIFF_DELTA_THRESHOLD) {
			return {
				attempted: false,
				updated: false,
				reason: `diff-delta-${delta}-lt-${TITLE_REROLL_DIFF_DELTA_THRESHOLD}`,
			};
		}

		const result = await rerollWorkLabel(
			ctx,
			getBranchMessages(ctx),
			diff.summary,
			diff.totalLines,
			runIdSnapshot,
			stateAfterReroll,
		);
		if (result.attempted) {
			lastRerollDiffLines = diff.totalLines;
		}
		return result;
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

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		promptCount = 0;
		promptsSinceReroll = 0;
		lastRerollDiffLines = null;
		refreshWorkLabel(ctx, undefined, { force: true });
		resetState(ctx, "new");
		clearFallbackRefresh();
		resetFallbackRefreshTimer(ctx);
	});

	pi.on("session_switch", async (event: SessionSwitchEvent, ctx: ExtensionContext) => {
		promptCount = 0;
		promptsSinceReroll = 0;
		lastRerollDiffLines = null;
		refreshWorkLabel(ctx, undefined, { force: true });
		resetState(ctx, event.reason === "new" ? "new" : "doneCommitted");
		clearFallbackRefresh();
		resetFallbackRefreshTimer(ctx);
	});

	pi.on("before_agent_start", async (event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		if (event.prompt.trim()) {
			promptCount += 1;
			if (labelMode === "reroll") {
				promptsSinceReroll += 1;
			}
		}
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
		void maybeRerollTitle(ctx, completedRunId, finalState)
			.then((result) => {
				if (!ctx.hasUI || result.updated || rerollHintShown) return;
				if (result.reason !== "no-model" && result.reason !== "no-api-key") return;
				rerollHintShown = true;
				ctx.ui.notify(`Tab reroll unavailable (${result.reason}). Try again after /login.`, "warning");
			})
			.catch(() => {
				// Best-effort only: keep existing label if reroll fails.
			});
	});


	pi.on("session_shutdown", async (_event: SessionShutdownEvent, ctx: ExtensionContext) => {
		clearTabTimeout();
		clearFallbackRefresh();
		if (!ctx.hasUI) return;
		ctx.ui.setTitle(displayLabel(ctx));
	});
}
