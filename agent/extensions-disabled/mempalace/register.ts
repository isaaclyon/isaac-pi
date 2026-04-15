import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import { emitMempalaceDebug, emitMempalaceDebugText, type MempalaceDebugState } from "./debug.js";
import { registerMempalaceLifecycleHooks } from "./lifecycle.js";
import { parseMempalaceMemoryMode, type MempalaceModeState } from "./mode.js";

interface OperationContext {
	cwd: string;
	sessionManager?: {
		getBranch?: () => unknown[];
		getSessionFile?: () => string | null;
	};
}

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
	isError?: boolean;
}

export interface MempalaceOperations {
	getStatus(ctx: OperationContext): Promise<ToolResult>;
	sync(ctx: OperationContext): Promise<ToolResult>;
	search(ctx: OperationContext, query: string): Promise<ToolResult>;
}

const SearchParams = Type.Object({
	query: Type.String({ description: "Search query for project memory" }),
});

const NoParams = Type.Object({});

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

async function runWithDebug(
	ctx: { ui?: { notify: (text: string, level: "info" | "warning" | "error") => void } },
	debugState: MempalaceDebugState,
	fallbackMeta: { action: "status" | "search" | "sync"; query?: string },
	run: () => Promise<ToolResult>,
): Promise<ToolResult> {
	const result = await run();
	emitMempalaceDebug(ctx, debugState, getDebugMeta(result) ?? fallbackMeta);
	return result;
}

async function notifyResult(ctx: { ui: { notify: (text: string, level: "info" | "warning" | "error") => void } }, result: ToolResult) {
	ctx.ui.notify(getPrimaryText(result), result.isError ? "error" : "info");
}

export function registerMempalaceExtension(pi: ExtensionAPI, operations: MempalaceOperations): void {
	const debugState: MempalaceDebugState = { enabled: false };
	const modeState: MempalaceModeState = { mode: "wake-only" };

	pi.registerTool({
		name: "project_memory_status",
		label: "Project Memory Status",
		description: "Show status for this project's MemPalace memory store",
		parameters: NoParams,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return runWithDebug(
				ctx as OperationContext & { ui?: { notify: (text: string, level: "info" | "warning" | "error") => void } },
				debugState,
				{ action: "status" },
				() => operations.getStatus(ctx as OperationContext),
			);
		},
	});

	pi.registerTool({
		name: "project_memory_sync",
		label: "Project Memory Sync",
		description: "Sync the current pi session branch into project memory",
		parameters: NoParams,
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			return runWithDebug(
				ctx as OperationContext & { ui?: { notify: (text: string, level: "info" | "warning" | "error") => void } },
				debugState,
				{ action: "sync" },
				() => operations.sync(ctx as OperationContext),
			);
		},
	});

	pi.registerTool({
		name: "project_memory_search",
		label: "Project Memory Search",
		description: "Search long-term memory for the current project",
		parameters: SearchParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const query = String(params.query);
			return runWithDebug(
				ctx as OperationContext & { ui?: { notify: (text: string, level: "info" | "warning" | "error") => void } },
				debugState,
				{ action: "search", query },
				() => operations.search(ctx as OperationContext, query),
			);
		},
	});

	pi.registerCommand("memory-status", {
		description: "Show project memory status",
		handler: async (_args, ctx) => {
			await notifyResult(
				ctx,
				await runWithDebug(
					ctx as OperationContext & { ui: { notify: (text: string, level: "info" | "warning" | "error") => void } },
					debugState,
					{ action: "status" },
					() => operations.getStatus(ctx as OperationContext),
				),
			);
		},
	});

	pi.registerCommand("memory-sync", {
		description: "Sync the current session branch into project memory",
		handler: async (_args, ctx) => {
			await notifyResult(
				ctx,
				await runWithDebug(
					ctx as OperationContext & { ui: { notify: (text: string, level: "info" | "warning" | "error") => void } },
					debugState,
					{ action: "sync" },
					() => operations.sync(ctx as OperationContext),
				),
			);
		},
	});

	pi.registerCommand("memory-search", {
		description: "Search project memory",
		handler: async (args, ctx) => {
			const query = args.trim();
			if (!query) {
				ctx.ui.notify("Usage: /memory-search <query>", "error");
				return;
			}
			await notifyResult(
				ctx,
				await runWithDebug(
					ctx as OperationContext & { ui: { notify: (text: string, level: "info" | "warning" | "error") => void } },
					debugState,
					{ action: "search", query },
					() => operations.search(ctx as OperationContext, query),
				),
			);
		},
	});

	pi.registerCommand("memory-debug", {
		description: "Toggle MemPalace debug notifications for this session",
		handler: async (_args, ctx) => {
			debugState.enabled = !debugState.enabled;
			emitMempalaceDebugText(ctx, { enabled: true }, `MemPalace debug: ${debugState.enabled ? "on" : "off"}`);
		},
	});

	pi.registerCommand("memory-mode", {
		description: "Set MemPalace recall mode for this session",
		handler: async (args, ctx) => {
			const mode = parseMempalaceMemoryMode(args);
			if (!mode) {
				ctx.ui.notify("Usage: /memory-mode <wake-only|selective>", "error");
				return;
			}
			modeState.mode = mode;
			ctx.ui.notify(`MemPalace mode: ${mode}`, "info");
		},
	});

	registerMempalaceLifecycleHooks(pi, operations, debugState, modeState);
}
