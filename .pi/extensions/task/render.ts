/**
 * TUI rendering for the task tool call + result display.
 *
 * Intentionally uses only pi core UI primitives (Text) to avoid extra
 * runtime dependencies in published packages.
 */

import * as os from "node:os";
import type {
	AgentToolResult,
	Theme,
	ToolRenderResultOptions,
} from "@mariozechner/pi-coding-agent";
import type { Component } from "@mariozechner/pi-tui";
import { Text } from "@mariozechner/pi-tui";
import type { Message } from "@mariozechner/pi-ai";
import type { SingleResult, TaskToolDetails, UsageStats } from "./types.js";

type TaskStatus = "Running" | "Done" | "Failed" | "Pending";
type OverallStatus = "Running" | "Done" | "Failed";

function isTaskError(result: SingleResult): boolean {
	return (
		result.exitCode > 0 ||
		result.stopReason === "error" ||
		result.stopReason === "aborted" ||
		result.stopReason === "timeout"
	);
}

export const isTaskError2 = isTaskError;

function getTaskStatus(result: SingleResult): TaskStatus {
	if (result.exitCode === -2) return "Pending";
	if (result.exitCode === -1) return "Running";
	return isTaskError(result) ? "Failed" : "Done";
}

function getOverallStatus(
	results: SingleResult[],
	mode: "parallel" | "chain",
): OverallStatus {
	if (mode === "parallel") {
		if (results.some((r) => r.exitCode === -1)) return "Running";
		return results.some(isTaskError) ? "Failed" : "Done";
	}
	if (results.some(isTaskError)) return "Failed";
	if (results.some((r) => r.exitCode === -1 || r.exitCode === -2)) {
		return "Running";
	}
	return "Done";
}

function statusIcon(
	status: TaskStatus | OverallStatus,
	theme: Theme,
): string {
	if (status === "Done") return theme.fg("success", "✓");
	if (status === "Failed") return theme.fg("error", "✗");
	return theme.fg("warning", "⏳");
}

function fmtTokens(n: number): string {
	if (n < 1000) return n.toString();
	if (n < 10000) return `${(n / 1000).toFixed(1)}k`;
	if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
	return `${(n / 1_000_000).toFixed(1)}M`;
}

function fmtCost(cost: number): string {
	if (cost < 0.01) return "<$0.01";
	if (cost < 1) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
}

function aggregateUsage(results: SingleResult[]): UsageStats {
	const total: UsageStats = {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	};
	for (const r of results) {
		total.input += r.usage.input;
		total.output += r.usage.output;
		total.cacheRead += r.usage.cacheRead;
		total.cacheWrite += r.usage.cacheWrite;
		total.cost += r.usage.cost;
		total.turns += r.usage.turns;
	}
	return total;
}

export function getFinalOutput(messages: Message[]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role === "assistant") {
			for (const part of msg.content) {
				if (part.type === "text") return part.text;
			}
		}
	}
	return "";
}

export function getTaskErrorText(result: SingleResult): string {
	return (
		result.errorMessage ||
		result.stderr ||
		getFinalOutput(result.messages) ||
		"(no output)"
	);
}

function shortenPath(p: string): string {
	const home = os.homedir();
	return p.startsWith(home) ? `~${p.slice(home.length)}` : p;
}

function extractPath(args: Record<string, unknown>): string {
	if (typeof args.file_path === "string") return args.file_path;
	if (typeof args.path === "string") return args.path;
	return "...";
}

// ---------------------------------------------------------------------------
// Tool activity aggregation
// ---------------------------------------------------------------------------

/** Preferred display order for common tool names; unlisted tools sort alphabetically after. */
const TOOL_ORDER: readonly string[] = [
	"bash",
	"read",
	"write",
	"edit",
	"lsp",
	"web_fetch",
	"task",
];

/**
 * Count tool calls by name across all messages in the given results.
 * Returns a `Map<string, number>` ordered by `TOOL_ORDER` then alphabetically.
 */
function countToolCalls(results: SingleResult[]): Map<string, number> {
	const counts = new Map<string, number>();
	for (const r of results) {
		for (const msg of r.messages) {
			if (msg.role !== "assistant") continue;
			for (const part of msg.content) {
				if (part.type !== "toolCall") continue;
				counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
			}
		}
	}

	// Sort by preferred order, then alphabetically
	const sorted = new Map<string, number>();
	const orderIndex = (name: string) => {
		const idx = TOOL_ORDER.indexOf(name);
		return idx === -1 ? TOOL_ORDER.length : idx;
	};
	const keys = [...counts.keys()].sort((a, b) => {
		const oa = orderIndex(a);
		const ob = orderIndex(b);
		if (oa !== ob) return oa - ob;
		return a.localeCompare(b);
	});
	for (const k of keys) sorted.set(k, counts.get(k)!);
	return sorted;
}

/**
 * Format aggregated tool counts as a compact string like `bash(5) read(12) write(3)`.
 * Returns an empty string when there are no tool calls.
 */
export function formatToolCounts(results: SingleResult[]): string {
	const counts = countToolCalls(results);
	if (counts.size === 0) return "";
	const parts: string[] = [];
	for (const [name, count] of counts) {
		parts.push(`${name}(${count})`);
	}
	return parts.join(" ");
}

function getToolCallLines(messages: Message[], theme: Theme): string[] {
	const lines: string[] = [];
	for (const msg of messages) {
		if (msg.role !== "assistant") continue;
		for (const part of msg.content) {
			if (part.type !== "toolCall") continue;
			if (part.name === "bash") {
				const cmd =
					typeof part.arguments.command === "string"
						? part.arguments.command
						: "...";
				const preview = cmd.length > 60 ? `${cmd.slice(0, 60)}...` : cmd;
				lines.push(
					`${theme.fg("muted", "→ $")} ${theme.fg("toolOutput", preview)}`,
				);
				continue;
			}
			if (
				part.name === "read" ||
				part.name === "write" ||
				part.name === "edit"
			) {
				lines.push(
					`${theme.fg("muted", `→ ${part.name}`)} ${theme.fg("accent", shortenPath(extractPath(part.arguments)))}`,
				);
				continue;
			}
			const args = JSON.stringify(part.arguments);
			const preview = args.length > 50 ? `${args.slice(0, 50)}...` : args;
			lines.push(
				`${theme.fg("muted", "→")} ${theme.fg("accent", part.name)} ${theme.fg("dim", preview)}`,
			);
		}
	}
	return lines;
}

function renderTaskBlock(options: {
	result: SingleResult;
	theme: Theme;
	label: string;
	indent: number;
	expanded: boolean;
}): string[] {
	const { result, theme, label, indent, expanded } = options;
	const status = getTaskStatus(result);
	const pad = " ".repeat(indent);
	const pad2 = " ".repeat(indent + 2);
	const lines: string[] = [
		`${pad}${theme.fg("toolTitle", label)} ${statusIcon(status, theme)}`,
		`${pad2}Status: ${status}`,
	];

	if (result.skill) lines.push(`${pad2}Skill: ${result.skill}`);

	const prompt = result.prompt.trim();
	const promptPreview = expanded
		? prompt
		: prompt.length > 120
			? `${prompt.slice(0, 120)}...`
			: prompt;
	lines.push(`${pad2}Prompt: ${promptPreview || "(empty)"}`);

	if (expanded && status !== "Pending") {
		const toolCalls = getToolCallLines(result.messages, theme);
		if (toolCalls.length > 0) {
			lines.push(`${pad2}Logs:`);
			for (const l of toolCalls) lines.push(`${pad2}  ${l}`);
		}
	}

	if (status === "Done" || status === "Failed") {
		const output = isTaskError(result)
			? getTaskErrorText(result)
			: getFinalOutput(result.messages);
		const out = output.trim() || "(no output)";
		lines.push(`${pad2}Output:`);
		for (const line of out.split("\n")) lines.push(`${pad2}  ${line}`);

		const u = result.usage;
		const usageBits: string[] = [];
		if (u.turns) usageBits.push(`${u.turns} turn${u.turns > 1 ? "s" : ""}`);
		if (u.output) usageBits.push(`↓${fmtTokens(u.output)}`);
		if (u.cost) usageBits.push(fmtCost(u.cost));
		if (result.model) usageBits.push(result.model);
		if (result.thinking) usageBits.push(`thinking:${result.thinking}`);
		if (usageBits.length > 0) {
			lines.push(`${pad2}${theme.fg("muted", usageBits.join(" · "))}`);
		}
	}

	return lines;
}

// ---------------------------------------------------------------------------
// renderCall helpers
// ---------------------------------------------------------------------------

/**
 * Return the best short label for a task item in the call preview.
 * Priority: name → skill → first line of prompt.
 */
function getTaskCallLabel(task: unknown, maxLen: number): string {
	if (!task || typeof task !== "object") return "(unknown)";
	const t = task as Record<string, unknown>;

	for (const key of ["name", "skill", "prompt"] as const) {
		if (typeof t[key] === "string") {
			const raw = (t[key] as string).trim();
			if (!raw) continue;
			// For prompt, only use the first line
			const text = key === "prompt" ? (raw.split("\n")[0] ?? raw) : raw;
			return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
		}
	}
	return "(no prompt)";
}

export function renderCall(
	args: Record<string, unknown>,
	theme: Theme,
): Component {
	const mode = typeof args.type === "string" ? args.type : "single";
	const tasks = Array.isArray(args.tasks) ? args.tasks : [];
	const count = tasks.length;

	// Single (or degenerate): one-line summary with the prompt's first line
	if (mode === "single" || count <= 1) {
		const summary =
			count === 1
				? getTaskCallLabel(tasks[0], 70)
				: `${count} task${count !== 1 ? "s" : ""}`;
		return new Text(
			`${theme.fg("toolTitle", "Task:")} ${theme.fg("accent", mode)} ${theme.fg("muted", summary)}`,
			0,
			0,
		);
	}

	// Parallel / chain: header + compact per-task list
	const noun = mode === "chain" ? "steps" : "tasks";
	const header = `${theme.fg("toolTitle", "Task:")} ${theme.fg("accent", mode)} ${theme.fg("muted", `${count} ${noun}`)}`;
	const lines: string[] = [header];

	for (let i = 0; i < count; i++) {
		const label = getTaskCallLabel(tasks[i], 60);
		const bullet =
			mode === "chain"
				? theme.fg("muted", `  ${i + 1}.`)
				: theme.fg("muted", "  ·");
		lines.push(`${bullet} ${label}`);
	}

	return new Text(lines.join("\n"), 0, 0);
}

export function renderResult(
	result: AgentToolResult<TaskToolDetails>,
	options: ToolRenderResultOptions,
	theme: Theme,
): Component {
	const details = result.details;
	if (!details || details.results.length === 0) {
		const text = result.content[0];
		return new Text(text?.type === "text" ? text.text : "(no output)", 0, 0);
	}

	if (details.mode === "single" && details.results.length === 1) {
		const singleResult = details.results[0]!;
		return new Text(
			renderTaskBlock({
				result: singleResult,
				theme,
				label: singleResult.name ?? "task",
				indent: 0,
				expanded: options.expanded,
			}).join("\n"),
			0,
			0,
		);
	}

	const mode = details.mode as "parallel" | "chain";
	const overall = getOverallStatus(details.results, mode);
	const done = details.results.filter((r) => r.exitCode !== -1 && r.exitCode !== -2).length;
	const toolActivity = formatToolCounts(details.results);
	const statusSuffix = overall === "Running" ? ` (${done}/${details.results.length} done)` : "";
	const activitySuffix = toolActivity ? ` · ${theme.fg("muted", toolActivity)}` : "";
	const lines: string[] = [
		`${theme.fg("toolTitle", `task (${mode})`)} ${statusIcon(overall, theme)}`,
		`  Status: ${overall}${statusSuffix}${activitySuffix}`,
	];

	for (let i = 0; i < details.results.length; i++) {
		const r = details.results[i]!;
		const defaultLabel = mode === "chain" ? `Step ${i + 1}` : `Task ${i + 1}`;
		lines.push("");
		lines.push(
			...renderTaskBlock({
				result: r,
				theme,
				label: r.name ?? defaultLabel,
				indent: 2,
				expanded: options.expanded,
			}),
		);
	}

	const usage = aggregateUsage(details.results);
	const usageBits: string[] = [];
	if (usage.turns) usageBits.push(`${usage.turns} turns`);
	if (usage.output) usageBits.push(`↓${fmtTokens(usage.output)}`);
	if (usage.cost) usageBits.push(fmtCost(usage.cost));
	if (usageBits.length > 0) {
		lines.push("");
		lines.push(`  ${theme.fg("muted", `${overall === "Running" ? "Usage so far" : "Total usage"}: ${usageBits.join(" · ")}`)}`);
	}

	return new Text(lines.join("\n"), 0, 0);
}
