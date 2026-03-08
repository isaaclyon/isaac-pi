import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { RalphExtensionConfig, RalphRunConfig, RalphSuccessConfig } from "./types.js";

const DEFAULT_SUCCESS: RalphSuccessConfig = {
	mode: "deterministic-tdd",
	mustFail: ["echo 'configure mustFail commands' && exit 1"],
	mustPass: ["echo 'configure mustPass commands' && exit 1"],
};

const DEFAULT_RUN: RalphRunConfig = {
	task: "",
	maxLoops: 8,
	budget: {
		contextThresholdPercent: 50,
		maxAssistantTurns: null,
		maxToolCalls: null,
	},
	success: DEFAULT_SUCCESS,
	runner: {
		cwd: ".",
		model: null,
		tools: null,
		tmuxSessionPrefix: "ralph",
		modelContextWindowTokens: 200_000,
	},
};

const DEFAULTS: RalphExtensionConfig = {
	enabled: false,
	dbPath: join(homedir(), ".pi", "agent", "ralph-loop", "ralph-loop.sqlite"),
	defaultRun: DEFAULT_RUN,
};

function parseBoolean(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (["1", "true", "yes", "on"].includes(normalized)) return true;
	if (["0", "false", "no", "off"].includes(normalized)) return false;
	return undefined;
}

function parseNullableInt(value: unknown, min: number): number | null | undefined {
	if (value === null) return null;
	if (typeof value === "number" && Number.isFinite(value)) return Math.max(min, Math.floor(value));
	if (typeof value !== "string") return undefined;
	const trimmed = value.trim().toLowerCase();
	if (!trimmed || trimmed === "null" || trimmed === "none" || trimmed === "off") return null;
	const parsed = Number(trimmed);
	if (!Number.isFinite(parsed)) return undefined;
	return Math.max(min, Math.floor(parsed));
}

function parsePercent(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return Math.min(95, Math.max(5, value));
	}
	if (typeof value !== "string") return undefined;
	const parsed = Number(value.trim());
	if (!Number.isFinite(parsed)) return undefined;
	return Math.min(95, Math.max(5, parsed));
}

function toStringArray(value: unknown): string[] | null | undefined {
	if (value === null) return null;
	if (!Array.isArray(value)) return undefined;
	const items = value
		.filter((item) => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return items;
}

function readProjectConfig(cwd: string): Partial<RalphExtensionConfig> {
	const filePath = join(cwd, ".pi", "ralph-loop.json");
	if (!existsSync(filePath)) return {};
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<RalphExtensionConfig>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function mergeSuccessConfig(value: unknown): RalphSuccessConfig {
	if (!value || typeof value !== "object") return DEFAULT_SUCCESS;
	const candidate = value as Partial<RalphSuccessConfig>;
	if (candidate.mode === "deterministic-tdd") {
		const mustFail = toStringArray((candidate as { mustFail?: unknown }).mustFail) ?? [];
		const mustPass = toStringArray((candidate as { mustPass?: unknown }).mustPass) ?? [];
		if (mustFail.length > 0 && mustPass.length > 0) {
			return { mode: "deterministic-tdd", mustFail, mustPass };
		}
		return DEFAULT_SUCCESS;
	}
	if (candidate.mode === "quantitative") {
		const checks = Array.isArray((candidate as { checks?: unknown }).checks)
			? ((candidate as { checks?: unknown[] }).checks ?? [])
				.filter((item) => item && typeof item === "object" && typeof (item as { command?: unknown }).command === "string")
				.map((item) => ({
					command: String((item as { command: string }).command),
					expectedExitCode:
						typeof (item as { expectedExitCode?: unknown }).expectedExitCode === "number"
							? Math.floor((item as { expectedExitCode: number }).expectedExitCode)
							: undefined,
					stdoutIncludes:
						typeof (item as { stdoutIncludes?: unknown }).stdoutIncludes === "string"
							? (item as { stdoutIncludes: string }).stdoutIncludes
							: undefined,
					stdoutExcludes:
						typeof (item as { stdoutExcludes?: unknown }).stdoutExcludes === "string"
							? (item as { stdoutExcludes: string }).stdoutExcludes
							: undefined,
					stderrIncludes:
						typeof (item as { stderrIncludes?: unknown }).stderrIncludes === "string"
							? (item as { stderrIncludes: string }).stderrIncludes
							: undefined,
					stderrExcludes:
						typeof (item as { stderrExcludes?: unknown }).stderrExcludes === "string"
							? (item as { stderrExcludes: string }).stderrExcludes
							: undefined,
				} as const))
			: [];
		if (checks.length > 0) return { mode: "quantitative", checks };
		return DEFAULT_SUCCESS;
	}
	if (candidate.mode === "qualitative") {
		const allowStandalone = parseBoolean((candidate as { allowStandalone?: unknown }).allowStandalone);
		const notes = typeof (candidate as { notes?: unknown }).notes === "string" ? (candidate as { notes: string }).notes : undefined;
		return { mode: "qualitative", allowStandalone, notes };
	}
	if (candidate.mode === "hybrid") {
		return {
			mode: "hybrid",
			deterministic: (candidate as { deterministic?: any }).deterministic,
			quantitative: (candidate as { quantitative?: any }).quantitative,
			qualitative: (candidate as { qualitative?: any }).qualitative,
		};
	}
	return DEFAULT_SUCCESS;
}

function mergeRunConfig(base: RalphRunConfig, override: unknown): RalphRunConfig {
	if (!override || typeof override !== "object") return base;
	const candidate = override as Partial<RalphRunConfig>;

	const task = typeof candidate.task === "string" ? candidate.task : base.task;
	const maxLoops =
		typeof candidate.maxLoops === "number" && Number.isFinite(candidate.maxLoops)
			? Math.max(1, Math.floor(candidate.maxLoops))
			: base.maxLoops;

	const budgetCandidate = candidate.budget ?? {};
	const contextThresholdPercent = parsePercent((budgetCandidate as { contextThresholdPercent?: unknown }).contextThresholdPercent)
		?? base.budget.contextThresholdPercent;
	const maxAssistantTurns = parseNullableInt((budgetCandidate as { maxAssistantTurns?: unknown }).maxAssistantTurns, 1)
		?? base.budget.maxAssistantTurns;
	const maxToolCalls = parseNullableInt((budgetCandidate as { maxToolCalls?: unknown }).maxToolCalls, 1)
		?? base.budget.maxToolCalls;

	const runnerCandidate = candidate.runner ?? {};
	const cwd = typeof (runnerCandidate as { cwd?: unknown }).cwd === "string" ? (runnerCandidate as { cwd: string }).cwd : base.runner.cwd;
	const model = typeof (runnerCandidate as { model?: unknown }).model === "string"
		? (runnerCandidate as { model: string }).model
		: (runnerCandidate as { model?: unknown }).model === null
			? null
			: base.runner.model;
	const tools = toStringArray((runnerCandidate as { tools?: unknown }).tools) ?? base.runner.tools;
	const tmuxSessionPrefix =
		typeof (runnerCandidate as { tmuxSessionPrefix?: unknown }).tmuxSessionPrefix === "string"
			? (runnerCandidate as { tmuxSessionPrefix: string }).tmuxSessionPrefix.trim() || base.runner.tmuxSessionPrefix
			: base.runner.tmuxSessionPrefix;
	const modelContextWindowTokens =
		typeof (runnerCandidate as { modelContextWindowTokens?: unknown }).modelContextWindowTokens === "number"
			&& Number.isFinite((runnerCandidate as { modelContextWindowTokens: number }).modelContextWindowTokens)
			? Math.max(8_000, Math.floor((runnerCandidate as { modelContextWindowTokens: number }).modelContextWindowTokens))
			: base.runner.modelContextWindowTokens;

	return {
		task,
		maxLoops,
		budget: {
			contextThresholdPercent,
			maxAssistantTurns,
			maxToolCalls,
		},
		success: candidate.success === undefined ? base.success : mergeSuccessConfig(candidate.success),
		runner: {
			cwd,
			model,
			tools,
			tmuxSessionPrefix,
			modelContextWindowTokens,
		},
	};
}

export function resolveRalphConfig(cwd: string): RalphExtensionConfig {
	const project = readProjectConfig(cwd);
	const envEnabled = parseBoolean(process.env.PI_RALPH_ENABLED);
	const envDbPath = typeof process.env.PI_RALPH_DB_PATH === "string" ? process.env.PI_RALPH_DB_PATH.trim() : "";

	const mergedDefaultRun = mergeRunConfig(DEFAULT_RUN, project.defaultRun);
	const defaultRun = mergeRunConfig(mergedDefaultRun, {
		budget: {
			contextThresholdPercent: parsePercent(process.env.PI_RALPH_CONTEXT_THRESHOLD_PERCENT),
			maxAssistantTurns: parseNullableInt(process.env.PI_RALPH_MAX_ASSISTANT_TURNS, 1),
			maxToolCalls: parseNullableInt(process.env.PI_RALPH_MAX_TOOL_CALLS, 1),
		},
		runner: {
			model: process.env.PI_RALPH_MODEL,
			modelContextWindowTokens:
				typeof process.env.PI_RALPH_MODEL_CONTEXT_WINDOW_TOKENS === "string"
					? Number(process.env.PI_RALPH_MODEL_CONTEXT_WINDOW_TOKENS)
					: undefined,
		},
	});

	return {
		enabled: envEnabled ?? (typeof project.enabled === "boolean" ? project.enabled : DEFAULTS.enabled),
		dbPath: envDbPath || (typeof project.dbPath === "string" && project.dbPath.trim() ? project.dbPath.trim() : DEFAULTS.dbPath),
		defaultRun,
	};
}
