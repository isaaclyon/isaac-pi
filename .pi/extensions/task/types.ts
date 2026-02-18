/**
 * Shared types for the task extension.
 */

import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { Message } from "@mariozechner/pi-ai";

// ---------------------------------------------------------------------------
// Thinking
// ---------------------------------------------------------------------------

export const THINKING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
] as const;

export const THINKING_OPTIONS = ["inherit", ...THINKING_LEVELS] as const;

export type TaskThinking = (typeof THINKING_OPTIONS)[number];

// ---------------------------------------------------------------------------
// Params
// ---------------------------------------------------------------------------

export const MAX_TASKS = 8;
export const MAX_CONCURRENCY = 4;

export interface TaskWorkItem {
	name?: string;
	prompt: string;
	skill?: string;
	model?: string;
	thinking?: TaskThinking;
	/** Per-task timeout in seconds. Overrides the top-level default. */
	timeout?: number;
	/** Per-task working directory. Resolved relative to the parent ExecuteContext.cwd. */
	cwd?: string;
}

export interface NormalizedParams {
	mode: "single" | "parallel" | "chain";
	model?: string;
	thinking: TaskThinking;
	/** Default timeout in seconds applied to every task that doesn't set its own. */
	timeout?: number;
	items: TaskWorkItem[];
}

// ---------------------------------------------------------------------------
// Model resolution
// ---------------------------------------------------------------------------

export interface ProviderModel {
	provider: string;
	modelId: string;
	label: string;
}

// ---------------------------------------------------------------------------
// Subprocess results
// ---------------------------------------------------------------------------

export interface UsageStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
	contextTokens: number;
	turns: number;
}

export interface SingleResult {
	name?: string;
	prompt: string;
	skill?: string;
	index?: number;
	exitCode: number;
	messages: Message[];
	stderr: string;
	usage: UsageStats;
	model?: string;
	thinking?: ThinkingLevel;
	stopReason?: string;
	errorMessage?: string;
}

export interface TaskToolDetails {
	mode: "single" | "parallel" | "chain";
	modelOverride?: string;
	results: SingleResult[];
}

// ---------------------------------------------------------------------------
// Built-in tools
// ---------------------------------------------------------------------------

const BUILT_IN_TOOLS = [
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
] as const;

export type BuiltInToolName = (typeof BUILT_IN_TOOLS)[number];

export function getBuiltInToolsFromActiveTools(
	activeTools: string[],
): BuiltInToolName[] {
	return activeTools.filter((t): t is BuiltInToolName =>
		(BUILT_IN_TOOLS as readonly string[]).includes(t),
	);
}
