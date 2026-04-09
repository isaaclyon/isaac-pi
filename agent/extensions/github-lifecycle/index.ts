import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";

import { formatFooterStatus, parsePrViewJson, type PrSnapshot } from "./github.js";
import { getAnnouncement, getAnnouncementKey, getPollIntervalMs, stabilizeSnapshot, type PrAnnouncement } from "./poller.js";
import { createEmptyTrackerState, getLatestTrackerState, TRACKER_STATE_TYPE, type TrackerState } from "./state.js";

const STATUS_KEY = "github-pr";
const EVENT_TYPE = "github-pr-event";
const PR_VIEW_FIELDS = [
	"number",
	"title",
	"url",
	"state",
	"isDraft",
	"mergedAt",
	"mergeable",
	"mergeStateStatus",
	"statusCheckRollup",
	"headRefName",
	"baseRefName",
	"updatedAt",
].join(",");

function parsePrTrackArg(arg: string): string | undefined {
	const trimmed = arg.trim();
	if (!trimmed) return undefined;

	const urlMatch = trimmed.match(/github\.com\/[^/]+\/[^/]+\/pull\/(\d+)/i);
	if (urlMatch) return urlMatch[1];
	return trimmed;
}

function isGhPrCreate(command: string | undefined): boolean {
	if (!command) return false;
	return /(^|\s)gh\s+pr\s+create(\s|$)/.test(command);
}

function sendLifecycleMessage(pi: ExtensionAPI, announcement: PrAnnouncement): void {
	pi.sendMessage(
		{
			customType: EVENT_TYPE,
			content: announcement.text,
			display: true,
			details: {
				level: announcement.level,
				timestamp: Date.now(),
				key: announcement.key,
			},
		},
		{ triggerTurn: false },
	);
}

function setFooterStatus(ctx: ExtensionContext, snapshot: PrSnapshot | null, lastError: string | null): void {
	if (!ctx.hasUI) return;
	if (lastError) {
		ctx.ui.setStatus(STATUS_KEY, `PR auth error`);
		return;
	}
	ctx.ui.setStatus(STATUS_KEY, snapshot ? formatFooterStatus(snapshot) : undefined);
}

async function fetchSnapshot(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	trackedPr: { repo: string; prNumber: number } | null,
	ref?: string,
): Promise<PrSnapshot> {
	const args = ["pr", "view"];
	if (ref) {
		args.push(ref);
	} else if (trackedPr) {
		args.push(String(trackedPr.prNumber), "--repo", trackedPr.repo);
	}
	args.push("--json", PR_VIEW_FIELDS);

	const result = await pi.exec("gh", args, { cwd: ctx.cwd, timeout: 10_000 });
	if (result.code !== 0) {
		throw new Error(result.stderr || result.stdout || "Failed to load PR status");
	}
	return parsePrViewJson(result.stdout);
}

export default function githubLifecycleExtension(pi: ExtensionAPI): void {
	let currentCtx: ExtensionContext | null = null;
	let state: TrackerState = createEmptyTrackerState();
	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	function clearPollTimer(): void {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	}

	function persistState(): void {
		pi.appendEntry(TRACKER_STATE_TYPE, state);
	}

	function schedulePoll(): void {
		clearPollTimer();
		if (!currentCtx || !state.trackedPr) return;
		const intervalMs = getPollIntervalMs(state.snapshot);
		if (intervalMs === null) return;
		pollTimer = setTimeout(() => {
			void pollNow(false);
		}, intervalMs);
		pollTimer.unref?.();
	}

	function applySnapshot(ctx: ExtensionContext, snapshot: PrSnapshot, options: { announce: boolean; trackingSource?: "auto" | "manual" }): void {
		const previous = state.snapshot;
		const stableSnapshot = stabilizeSnapshot(previous, snapshot);
		state = {
			...state,
			trackedPr: { repo: stableSnapshot.repo, prNumber: stableSnapshot.prNumber },
			snapshot: stableSnapshot,
			lastError: null,
			lastPolledAt: new Date().toISOString(),
			trackingSource: options.trackingSource ?? state.trackingSource,
		};
		setFooterStatus(ctx, stableSnapshot, null);

		const announcement = options.announce ? getAnnouncement(previous, stableSnapshot, state.lastAnnouncedKey) : null;
		if (announcement) {
			state.lastAnnouncedKey = announcement.key;
			sendLifecycleMessage(pi, announcement);
		}

		persistState();
		schedulePoll();
	}

	function applyPollError(ctx: ExtensionContext, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		if (state.lastError === message) {
			setFooterStatus(ctx, state.snapshot, state.lastError);
			schedulePoll();
			return;
		}

		state = {
			...state,
			lastError: message,
			lastPolledAt: new Date().toISOString(),
		};
		setFooterStatus(ctx, state.snapshot, message);
		persistState();

		const errorKey = `poll_error|${message}`;
		if (state.lastAnnouncedKey !== errorKey) {
			state.lastAnnouncedKey = errorKey;
			sendLifecycleMessage(pi, {
				key: errorKey,
				level: "warning",
				text: `PR #${state.trackedPr?.prNumber ?? "?"}: status refresh failed (${message})`,
			});
			persistState();
		}
		schedulePoll();
	}

	async function pollNow(announce: boolean): Promise<void> {
		if (!currentCtx || !state.trackedPr) return;
		try {
			const snapshot = await fetchSnapshot(pi, currentCtx, state.trackedPr);
			applySnapshot(currentCtx, snapshot, { announce });
		} catch (error) {
			applyPollError(currentCtx, error);
		}
	}

	async function trackPr(ctx: ExtensionContext, ref: string | undefined, trackingSource: "auto" | "manual"): Promise<void> {
		const snapshot = await fetchSnapshot(pi, ctx, null, ref);
		applySnapshot(ctx, snapshot, { announce: true, trackingSource });
	}

	function restoreState(ctx: ExtensionContext): void {
		state = getLatestTrackerState(ctx.sessionManager.getEntries());
		setFooterStatus(ctx, state.snapshot, state.lastError);
		schedulePoll();
	}

	async function handleSessionActivation(ctx: ExtensionContext): Promise<void> {
		currentCtx = ctx;
		restoreState(ctx);
		if (state.trackedPr) {
			await pollNow(true);
		}
	}

	pi.registerMessageRenderer(EVENT_TYPE, (message, _options, theme) => {
		const details = message.details as { level?: string } | undefined;
		const level = details?.level ?? "info";
		const color = level === "error" ? "error" : level === "warning" ? "warning" : level === "success" ? "success" : "accent";
		const box = new Box(1, 1, (text: string) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg(color, String(message.content)), 0, 0));
		return box;
	});

	pi.registerCommand("pr-track", {
		description: "Track a GitHub pull request for this conversation",
		handler: async (args: string, ctx: ExtensionContext) => {
			currentCtx = ctx;
			try {
				await trackPr(ctx, parsePrTrackArg(args), "manual");
			} catch (error) {
				ctx.ui.notify(`Failed to track PR: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		},
	});

	pi.registerCommand("pr-untrack", {
		description: "Stop tracking the current conversation PR",
		handler: async (_args: string, ctx: ExtensionContext) => {
			currentCtx = ctx;
			clearPollTimer();
			state = createEmptyTrackerState();
			setFooterStatus(ctx, null, null);
			persistState();
			ctx.ui.notify("Stopped tracking PR status", "info");
		},
	});

	pi.registerCommand("pr-status", {
		description: "Post the latest tracked PR status into the conversation",
		handler: async (_args: string, ctx: ExtensionContext) => {
			currentCtx = ctx;
			if (!state.snapshot) {
				ctx.ui.notify("No PR is currently tracked", "warning");
				return;
			}
			sendLifecycleMessage(pi, {
				key: getAnnouncementKey(state.snapshot),
				level: "info",
				text: `${formatFooterStatus(state.snapshot)} · ${state.snapshot.title}`,
			});
		},
	});

	pi.registerCommand("pr-refresh", {
		description: "Force an immediate PR status refresh",
		handler: async (_args: string, ctx: ExtensionContext) => {
			currentCtx = ctx;
			await pollNow(true);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		await handleSessionActivation(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await handleSessionActivation(ctx);
	});

	pi.on("session_shutdown", async () => {
		clearPollTimer();
		currentCtx = null;
	});

	pi.on("tool_result", async (event, ctx) => {
		currentCtx = ctx;
		if (event.toolName !== "bash" || event.isError) return;
		if (!isGhPrCreate(event.input?.command)) return;

		try {
			await trackPr(ctx, undefined, "auto");
		} catch (error) {
			ctx.ui.notify(`PR created, but tracking failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
	});
}
