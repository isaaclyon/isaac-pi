/**
 * context-banner.ts
 *
 * A non-capturing overlay pinned to the top-center of the terminal that shows
 * a one-sentence LLM-generated description of what the current session is
 * working on.
 *
 * • ctrl+alt+f  — toggle show / hide
 * • /banner     — force regenerate + show
 */

import type {
	AgentEndEvent,
	BeforeAgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
	SessionStartEvent,
	SessionSwitchEvent,
} from "@mariozechner/pi-coding-agent";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import { complete, type Api, type AssistantMessage, type Model, type UserMessage } from "@mariozechner/pi-ai";
import type { OverlayHandle, TUI } from "@mariozechner/pi-tui";
import { truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

// ─── Constants ──────────────────────────────────────────────────────────────

const CONTEXT_PROVIDER = "openai-codex";
const CONTEXT_MODEL_ID = "gpt-5.3-codex-spark";
const CONTEXT_MAX_TOKENS = 80;
const REFRESH_INTERVAL_MS = 5 * 60_000;
const MAX_RECENT_MESSAGES = 10;
const MAX_MSG_CHARS = 500;
const MAX_BANNER_LINES = 3;
const SHORTCUT = "ctrl+alt+f";

const CONTEXT_SYSTEM_PROMPT = `You generate a one-sentence work-context summary for a developer's terminal banner.
Return only the summary text — nothing else.
Rules:
- Exactly 1 sentence, ≤ 35 words.
- Plain text only. No markdown. No quotes. No trailing punctuation.
- Describe the specific coding task currently in progress.
- Be concrete: mention files, functions, patterns, or goals being changed.
- Bad:  "Working on the codebase"
- Good: "Rewriting ingest tests to prevent race conditions by separating pipeline X from Y job queues"`;

// ─── Theme helper type (duck-typed from factory callback) ────────────────────

type ThemeRef = {
	fg(color: string, text: string): string;
	bold(text: string): string;
};

// ─── Banner component ────────────────────────────────────────────────────────

class ContextBannerComponent {
	private bannerText = "";
	private generating = false;
	private lastRefreshAt = 0;
	private cachedWidth: number | null = null;
	private cachedLines: string[] | null = null;

	constructor(
		private theme: ThemeRef,
		private tui: TUI,
	) {}

	/** Update banner content and trigger re-render. */
	update(text: string, generating: boolean): void {
		this.bannerText = text;
		this.generating = generating;
		if (!generating && text) this.lastRefreshAt = Date.now();
		this.cachedLines = null;
		this.tui.requestRender();
	}

	invalidate(): void {
		this.cachedLines = null;
		this.cachedWidth = null;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) return this.cachedLines;
		this.cachedWidth = width;
		this.cachedLines = this.buildLines(width);
		return this.cachedLines;
	}

	private buildLines(width: number): string[] {
		const th = this.theme;

		// Pure OLED black background (true-colour RGB 0,0,0).
		// TUI appends a full SGR reset at each line end so this won't bleed.
		const BG = "\x1b[48;2;0;0;0m";

		const innerW = Math.max(4, width - 2);

		const b = (s: string) => th.fg("accent", s);

		// Row: black bg + left border + content padded to innerW + right border
		const row = (content: string): string => {
			const safe = truncateToWidth(content, innerW);
			const vis = visibleWidth(safe);
			const pad = Math.max(0, innerW - vis);
			return BG + b("│") + safe + " ".repeat(pad) + b("│");
		};

		const lines: string[] = [];

		// ── Top border ──────────────────────────────────────────────────────
		const titleInner = `  🔭 Focus  `;
		const titleVis = visibleWidth(titleInner);
		const dashRight = Math.max(0, innerW - titleVis);
		lines.push(BG + b("╭") + th.fg("accent", titleInner) + b("─".repeat(dashRight)) + b("╮"));

		// ── Blank padding row above content ─────────────────────────────────
		lines.push(row(""));

		// ── Content ──────────────────────────────────────────────────────────
		const contentPadX = 3; // generous left/right padding inside borders
		const maxTextW = Math.max(1, innerW - contentPadX * 2);

		if (this.generating) {
			lines.push(row(" ".repeat(contentPadX) + th.fg("dim", "✦ generating…")));
		} else if (this.bannerText) {
			const wrapped = wrapTextWithAnsi(this.bannerText, maxTextW).slice(0, MAX_BANNER_LINES);
			for (const line of wrapped) {
				lines.push(row(" ".repeat(contentPadX) + line));
			}
		} else {
			lines.push(row(" ".repeat(contentPadX) + th.fg("dim", "No context yet — prompting now…")));
		}

		// ── Blank padding row below content ─────────────────────────────────
		lines.push(row(""));

		// ── Bottom border with time-ago + shortcut hint ──────────────────────
		const mins = this.lastRefreshAt > 0 ? Math.floor((Date.now() - this.lastRefreshAt) / 60_000) : -1;
		const timeLabel = mins >= 0 ? `  ${mins === 0 ? "just now" : `${mins}m ago`}` : "";
		const hintLabel = `${SHORTCUT} to dismiss  `;
		const leftPart = th.fg("dim", timeLabel);
		const rightPart = th.fg("dim", hintLabel);
		const leftVis = visibleWidth(leftPart);
		const rightVis = visibleWidth(rightPart);
		const dashes = Math.max(0, innerW - leftVis - rightVis);
		lines.push(BG + b("╰") + leftPart + b("─".repeat(dashes)) + rightPart + b("╯"));

		return lines;
	}
}

// ─── Main extension ──────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
	const nativeClearInterval = globalThis.clearInterval;
	const nativeSetInterval = globalThis.setInterval;

	// ── Shared mutable state ────────────────────────────────────────────────
	let activeCtx: ExtensionContext | null = null;
	let component: ContextBannerComponent | null = null;
	let overlayHandle: OverlayHandle | null = null;
	let dismissFn: (() => void) | null = null;
	let bannerText = "";
	let promptsSinceRegen = 0;
	let genRunId = 0;
	let refreshTimer: ReturnType<typeof setInterval> | null = null;
	let bannerHidden = true; // disabled by default; user can enable via shortcut or /banner command

	// ── Overlay lifecycle ───────────────────────────────────────────────────

	/**
	 * Create the overlay if it doesn't exist yet (fire-and-forget), then
	 * ensure it's visible.
	 */
	const showBanner = (ctx: ExtensionContext): void => {
		if (!ctx.hasUI) return;

		// Already open — just un-hide if needed
		if (overlayHandle) {
			if (!bannerHidden) overlayHandle.setHidden(false);
			return;
		}

		// Fire-and-forget: the overlay lives until dismissed or session ends
		void ctx.ui
			.custom<void>(
				(tui, theme, _kb, done) => {
					dismissFn = done;
					component = new ContextBannerComponent(theme, tui);
					// Populate immediately from cached text if available
					component.update(bannerText, false);
					return component;
				},
				{
					overlay: true,
					overlayOptions: {
						nonCapturing: true,
						anchor: "top-center",
						width: "90%",
						margin: { top: 2 },
						visible: (tw: number) => tw >= 60,
					},
					onHandle: (handle) => {
						overlayHandle = handle;
						if (bannerHidden) handle.setHidden(true);
					},
				},
			)
			.then(() => {
				// Overlay was closed (done() was called); clean up refs
				overlayHandle = null;
				component = null;
				dismissFn = null;
			});
	};

	const hideBanner = (): void => {
		bannerHidden = true;
		overlayHandle?.setHidden(true);
	};

	const unhideBanner = (): void => {
		bannerHidden = false;
		overlayHandle?.setHidden(false);
	};

	const toggleBanner = (): void => {
		if (bannerHidden) {
			unhideBanner();
		} else {
			hideBanner();
		}
	};

	// ── Model selection (mirror tab-status.ts logic) ────────────────────────

	const selectModel = (ctx: ExtensionContext): Model<Api> | undefined => {
		const exact = ctx.modelRegistry.find(CONTEXT_PROVIDER, CONTEXT_MODEL_ID) as Model<Api> | undefined;
		if (exact) return exact;
		const available = ctx.modelRegistry.getAvailable();
		const sparkLike = available.find(
			(m) => m.provider === CONTEXT_PROVIDER && m.id.toLowerCase().includes("codex-spark"),
		) as Model<Api> | undefined;
		if (sparkLike) return sparkLike;
		if (ctx.model?.provider === CONTEXT_PROVIDER) return ctx.model as Model<Api>;
		return undefined;
	};

	// ── Message extraction ──────────────────────────────────────────────────

	const getMessageText = (msg: AgentMessage): string => {
		if (!msg || typeof msg !== "object") return "";
		const m = msg as { role?: string; content?: unknown };
		if (m.role !== "user" && m.role !== "assistant") return "";
		const { content } = m;
		if (typeof content === "string") return content.trim();
		if (!Array.isArray(content)) return "";
		return content
			.map((part) => {
				if (!part || typeof part !== "object") return "";
				const p = part as { type?: string; text?: unknown };
				return p.type === "text" && typeof p.text === "string" ? p.text : "";
			})
			.join(" ")
			.replace(/\s+/g, " ")
			.trim();
	};

	const parseNumstat = (numstat: string): string[] => {
		return numstat
			.split("\n")
			.map((l) => l.trim())
			.filter(Boolean)
			.flatMap((line) => {
				const parts = line.split("\t");
				if (parts.length < 3) return [];
				const [addedRaw, deletedRaw, file] = parts;
				const added = Number.parseInt(addedRaw!, 10);
				const deleted = Number.parseInt(deletedRaw!, 10);
				const binary = Number.isNaN(added) || Number.isNaN(deleted);
				return [`${file} ${binary ? "(binary)" : `(+${added}/-${deleted})`}`];
			});
	};

	const getGitDiff = async (ctx: ExtensionContext): Promise<string> => {
		const diff = await pi.exec("git", ["diff", "--numstat", "HEAD", "--"], {
			cwd: ctx.cwd,
			timeout: 5000,
		});
		if (diff.code !== 0) return "";
		const changed = parseNumstat(diff.stdout);
		const untracked = await pi.exec("git", ["ls-files", "--others", "--exclude-standard"], {
			cwd: ctx.cwd,
			timeout: 5000,
		});
		const newFiles = untracked.code === 0
			? untracked.stdout.split("\n").map((l) => l.trim()).filter(Boolean).map((f) => `${f} (new file)`)
			: [];
		const all = [...changed, ...newFiles].slice(0, 20);
		return all.length > 0 ? all.join("\n") : "no uncommitted changes";
	};

	const buildContextPrompt = async (ctx: ExtensionContext): Promise<string> => {
		const branch = ctx.sessionManager.getBranch();
		const allMessages: { role: string; text: string }[] = [];

		for (const entry of branch) {
			if (entry.type !== "message") continue;
			const m = entry.message as { role?: string };
			if (m.role !== "user" && m.role !== "assistant") continue;
			const text = getMessageText(entry.message);
			if (!text) continue;
			allMessages.push({ role: m.role!, text });
		}

		if (allMessages.length === 0) return "";

		// First 3 user messages — initial intent anchor
		const firstUserMsgs = allMessages
			.filter((m) => m.role === "user")
			.slice(0, 3)
			.map((m) => m.text.slice(0, MAX_MSG_CHARS));

		// Last 6 messages (user + assistant) — recent activity
		const recentMsgs = allMessages
			.slice(-6)
			.map((m) => `[${m.role}] ${m.text.slice(0, MAX_MSG_CHARS)}`);

		// Git diff — what has actually changed on disk
		const diffSummary = await getGitDiff(ctx);

		const parts: string[] = [];

		parts.push("=== Initial intent (first user messages) ===");
		parts.push(firstUserMsgs.map((t, i) => `${i + 1}. ${t}`).join("\n\n"));

		parts.push("\n=== Recent conversation (last 6 turns) ===");
		parts.push(recentMsgs.join("\n\n"));

		parts.push("\n=== Uncommitted file changes (git diff) ===");
		parts.push(diffSummary);

		return parts.join("\n");
	};

	// ── Context generation ──────────────────────────────────────────────────

	const generateContext = async (ctx: ExtensionContext, force = false): Promise<void> => {
		if (!ctx.hasUI) return;
		if (!force && promptsSinceRegen < 1) return;

		const model = selectModel(ctx);
		if (!model) return;

		const apiKey = await ctx.modelRegistry.getApiKey(model);
		if (!apiKey) return;

		const promptBody = await buildContextPrompt(ctx);
		if (!promptBody) return;

		genRunId += 1;
		const thisRun = genRunId;
		promptsSinceRegen = 0;

		// Show "generating" state
		component?.update(bannerText, true);

		try {
			const userMessage: UserMessage = {
				role: "user",
				content: [{ type: "text", text: promptBody }],
				timestamp: Date.now(),
			};

			const response: AssistantMessage = await complete(
				model,
				{ systemPrompt: CONTEXT_SYSTEM_PROMPT, messages: [userMessage] },
				{ apiKey, maxTokens: CONTEXT_MAX_TOKENS },
			);

			// Bail if a newer generation has started or session changed
			if (thisRun !== genRunId) return;

			if (response.stopReason === "error" || response.stopReason === "aborted") return;

			const generated = response.content
				.filter((p): p is { type: "text"; text: string } => p.type === "text")
				.map((p) => p.text)
				.join(" ")
				.replace(/\s+/g, " ")
				.replace(/^["']|["']$/g, "") // strip surrounding quotes
				.replace(/[.!?,;:]+$/, "") // strip trailing punctuation
				.trim();

			if (!generated) return;

			bannerText = generated;
			component?.update(bannerText, false);
		} catch {
			// Silently ignore generation errors; keep previous text
			component?.update(bannerText, false);
		}
	};

	// ── Refresh timer ───────────────────────────────────────────────────────

	const stopRefreshTimer = (): void => {
		if (refreshTimer !== null) {
			nativeClearInterval(refreshTimer);
			refreshTimer = null;
		}
	};

	const startRefreshTimer = (ctx: ExtensionContext): void => {
		stopRefreshTimer();
		refreshTimer = nativeSetInterval(async () => {
			if (activeCtx === ctx) {
				await generateContext(ctx, true);
			}
		}, REFRESH_INTERVAL_MS);
	};

	// ── Session events ──────────────────────────────────────────────────────

	const teardownOverlay = (): void => {
		// Dismiss any existing overlay and immediately clear shared state so that
		// showBanner always creates a fresh overlay bound to the current ctx/TUI.
		// The stale .then() callback may still fire and null things again — harmless.
		try { dismissFn?.(); } catch { /* ignore errors on a stale overlay */ }
		overlayHandle = null;
		component = null;
		dismissFn = null;
	};

	pi.on("session_start", async (_event: SessionStartEvent, ctx: ExtensionContext) => {
		activeCtx = ctx;
		bannerText = "";
		promptsSinceRegen = 0;
		genRunId += 1;

		// Tear down any stale overlay from the previous session before creating a
		// fresh one. Without this, showBanner sees overlayHandle != null and returns
		// early, leaving the new session's TUI with no properly-attached overlay.
		teardownOverlay();
		showBanner(ctx);
		startRefreshTimer(ctx);
	});

	pi.on("session_switch", async (_event: SessionSwitchEvent, ctx: ExtensionContext) => {
		activeCtx = ctx;
		bannerText = "";
		promptsSinceRegen = 0;
		genRunId += 1;
		// keep bannerHidden as-is; user must explicitly enable via shortcut or /banner

		// The old overlay belongs to the previous ctx's TUI instance. Tear it down
		// explicitly so showBanner creates a fresh one bound to the new ctx.
		teardownOverlay();
		showBanner(ctx);
		startRefreshTimer(ctx);
	});

	// ── Agent turn events ───────────────────────────────────────────────────

	pi.on("before_agent_start", async (_event: BeforeAgentStartEvent, ctx: ExtensionContext) => {
		activeCtx = ctx;
		promptsSinceRegen += 1;
	});

	pi.on("agent_end", async (_event: AgentEndEvent, ctx: ExtensionContext) => {
		activeCtx = ctx;
		// Regenerate after each completed turn (background; never blocks)
		void generateContext(ctx);
	});

	// ── Keyboard shortcut ───────────────────────────────────────────────────

	pi.registerShortcut(SHORTCUT, {
		description: "Toggle context banner",
		handler: async (ctx: ExtensionContext) => {
			if (!overlayHandle) {
				showBanner(ctx);
				bannerHidden = false;
			} else {
				toggleBanner();
			}
		},
	});

	// ── /banner command ─────────────────────────────────────────────────────

	pi.registerCommand("banner", {
		description: "Show / force-regenerate the focus context banner",
		handler: async (_args: string, ctx: ExtensionContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Context banner requires interactive mode", "warning");
				return;
			}
			bannerHidden = false;
			showBanner(ctx);
			ctx.ui.notify("Regenerating context banner…", "info");
			await generateContext(ctx, true);
		},
	});
}
