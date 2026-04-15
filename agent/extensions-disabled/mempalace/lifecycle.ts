import { realpathSync } from "node:fs";
import path from "node:path";

import type { BeforeAgentStartEvent, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import { emitMempalaceDebug, emitMempalaceDebugText, type MempalaceDebugState } from "./debug.js";
import { type MempalaceModeState } from "./mode.js";
import type { MempalaceOperations } from "./operations.js";

type LifecycleContext = Pick<ExtensionContext, "cwd" | "hasUI" | "sessionManager" | "ui">;

type ToolResult = {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
	isError?: boolean;
};

function getPrimaryText(result: ToolResult): string {
	return result.content.find((part) => part.type === "text")?.text ?? "";
}

function getDebugMeta(result: ToolResult) {
	const value = result.details?.mempalace;
	if (!value || typeof value !== "object") {
		return undefined;
	}
	return value as { action: "status" | "search" | "sync"; bootstrapped?: boolean; query?: string };
}

function shouldRequestRecall(prompt: string): boolean {
	const raw = prompt.trim();
	const normalized = raw.replace(/\s+/g, " ");
	const words = normalized.split(" ").filter(Boolean);
	if (normalized.length < 24) return false;
	if (words.length < 4) return false;
	if (normalized.startsWith("/")) return false;
	if (/```|=>|\bfunction\b|\bclass\b|\bconst\b|\blet\b|\bvar\b|\bimport\b|\bexport\b/.test(raw)) return false;
	return true;
}

function formatRecallContent(summary: string): string {
	const excerpt = summary
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.slice(0, 5)
		.join("\n");

	const trimmed = excerpt.slice(0, 500).trim();
	return trimmed ? `Relevant project memory:\n${trimmed}` : "";
}

async function syncProjectMemory(
	ctx: LifecycleContext,
	operations: MempalaceOperations,
	reason: string,
	debugState: MempalaceDebugState,
): Promise<void> {
	try {
		emitMempalaceDebugText(ctx, debugState, `MemPalace: auto-sync (${reason})`);
		const result = await operations.sync(ctx);
		emitMempalaceDebug(ctx, debugState, getDebugMeta(result) ?? { action: "sync" });
		if (!result.isError) {
			return;
		}

		const message = getPrimaryText(result) || `MemPalace ${reason} sync failed.`;
		if (ctx.hasUI) {
			ctx.ui.notify(message, "error");
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) {
			ctx.ui.notify(`MemPalace ${reason} sync failed: ${message}`, "error");
		}
	}
}

const autoSyncInFlightByProject = new Map<string, Promise<void>>();

function getProjectSyncKey(cwd: string): string | null {
	const projectRoot = path.resolve(cwd);
	try {
		return realpathSync(projectRoot);
	} catch {
		return null;
	}
}

function scheduleAutoSync(
	ctx: LifecycleContext,
	operations: MempalaceOperations,
	reason: string,
	debugState: MempalaceDebugState,
): Promise<void> {
	const projectKey = getProjectSyncKey(ctx.cwd);
	if (!projectKey) {
		if (ctx.hasUI) {
			ctx.ui.notify(`MemPalace ${reason} sync skipped: could not canonicalize project root`, "error");
		}
		return Promise.resolve();
	}

	const inFlight = autoSyncInFlightByProject.get(projectKey);
	if (inFlight) {
		return inFlight;
	}

	const pending = syncProjectMemory(ctx, operations, reason, debugState).finally(() => {
		if (autoSyncInFlightByProject.get(projectKey) === pending) {
			autoSyncInFlightByProject.delete(projectKey);
		}
	});
	autoSyncInFlightByProject.set(projectKey, pending);
	return pending;
}

async function maybeInjectRecall(
	event: BeforeAgentStartEvent,
	ctx: LifecycleContext,
	operations: MempalaceOperations,
	debugState: MempalaceDebugState,
	modeState: MempalaceModeState,
) {
	if (modeState.mode !== "selective") {
		return undefined;
	}
	const query = event.prompt.trim().replace(/\s+/g, " ");
	if (!shouldRequestRecall(query)) {
		return undefined;
	}

	try {
		emitMempalaceDebugText(ctx, debugState, "MemPalace: recall lookup");
		const result = await operations.search(ctx, query.slice(0, 240));
		emitMempalaceDebug(ctx, debugState, getDebugMeta(result) ?? { action: "search", query: query.slice(0, 240) });
		if (result.isError) {
			return undefined;
		}

		const summary = getPrimaryText(result).trim();
		if (!summary || /no matching memory found/i.test(summary)) {
			return undefined;
		}

		const content = formatRecallContent(summary);
		if (!content) {
			return undefined;
		}

		emitMempalaceDebugText(ctx, debugState, "MemPalace: recall injected");
		return {
			message: {
				customType: "mempalace-recall",
				content,
				display: false,
			},
		};
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (ctx.hasUI) {
			ctx.ui.notify(`MemPalace recall failed: ${message}`, "error");
		}
		return undefined;
	}
}

export function registerMempalaceLifecycleHooks(
	pi: ExtensionAPI,
	operations: MempalaceOperations,
	debugState: MempalaceDebugState = { enabled: false },
	modeState: MempalaceModeState = { mode: "wake-only" },
): void {
	pi.on("session_shutdown", (_event, ctx) => {
		void scheduleAutoSync(ctx as LifecycleContext, operations, "shutdown", debugState);
	});

	pi.on("session_before_compact", (_event, ctx) => {
		void scheduleAutoSync(ctx as LifecycleContext, operations, "pre-compaction", debugState);
	});

	pi.on("before_agent_start", async (event, ctx) =>
		maybeInjectRecall(event, ctx as LifecycleContext, operations, debugState, modeState),
	);
}
