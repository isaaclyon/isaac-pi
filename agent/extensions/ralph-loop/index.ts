import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { resolveRalphConfig } from "./config.js";
import { getRalphDb } from "./db.js";
import { startRalphRun } from "./engine.js";
import { RalphStore } from "./store.js";
import type { RalphRunConfig, RalphRunState, RalphSuccessConfig } from "./types.js";

type ActiveRun = {
	runId: string;
	controller: AbortController;
};

type RalphRuntime = {
	store: RalphStore;
	configDbPath: string;
	defaultRun: RalphRunConfig;
	activeRuns: Map<string, ActiveRun>;
	latestRunId: string | null;
};

type RalphActionLevel = "info" | "warning" | "error";

type RalphActionResult = {
	ok: boolean;
	level: RalphActionLevel;
	message: string;
	details?: Record<string, unknown>;
};

type RalphToolParams = {
	action: "start" | "stop" | "status" | "runs";
	cwd?: string;
	runId?: string;
	preset?: "deterministic-tdd" | "quantitative-only" | "hybrid";
	task?: string;
	maxLoops?: number;
	budget?: {
		contextThresholdPercent?: number;
		maxAssistantTurns?: number | null;
		maxToolCalls?: number | null;
	};
	success?: RalphSuccessConfig;
	runner?: {
		cwd?: string;
		model?: string | null;
		tools?: string[] | null;
		tmuxSessionPrefix?: string;
		modelContextWindowTokens?: number;
	};
	limit?: number;
};

const RalphToolParamsSchema = {
	type: "object",
	properties: {
		action: {
			type: "string",
			enum: ["start", "stop", "status", "runs"],
			description: "Action to perform: start | stop | status | runs",
		},
		cwd: { type: "string", description: "Optional cwd for runtime/config resolution." },
		runId: { type: "string", description: "Run id for stop/status actions." },
		preset: {
			type: "string",
			enum: ["deterministic-tdd", "quantitative-only", "hybrid"],
			description: "Optional start preset.",
		},
		task: { type: "string", description: "Task override for start action." },
		maxLoops: { type: "number", description: "Max loops override for start action." },
		budget: {
			type: "object",
			properties: {
				contextThresholdPercent: { type: "number" },
				maxAssistantTurns: { anyOf: [{ type: "number" }, { type: "null" }] },
				maxToolCalls: { anyOf: [{ type: "number" }, { type: "null" }] },
			},
		},
		success: { description: "Success config override for start action." },
		runner: {
			type: "object",
			properties: {
				cwd: { type: "string" },
				model: { anyOf: [{ type: "string" }, { type: "null" }] },
				tools: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
				tmuxSessionPrefix: { type: "string" },
				modelContextWindowTokens: { type: "number" },
			},
		},
		limit: { type: "number", description: "Runs list limit (default 10)." },
	},
	required: ["action"],
};

function toStringArray(value: unknown, field: string): string[] {
	if (!Array.isArray(value)) throw new Error(`success.${field} must be an array of non-empty strings.`);
	const items = value
		.filter((item) => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	if (items.length !== value.length) {
		throw new Error(`success.${field} must be an array of non-empty strings.`);
	}
	return items;
}

function parseSuccessConfig(override: unknown): RalphSuccessConfig {
	if (!override || typeof override !== "object") {
		throw new Error("success must be an object.");
	}

	const mode = (override as { mode?: unknown }).mode;
	if (mode === "deterministic-tdd") {
		return {
			mode,
			mustFail: toStringArray((override as { mustFail?: unknown }).mustFail, "mustFail"),
			mustPass: toStringArray((override as { mustPass?: unknown }).mustPass, "mustPass"),
		};
	}

	if (mode === "quantitative") {
		const checks = (override as { checks?: unknown }).checks;
		if (!Array.isArray(checks) || checks.length === 0) {
			throw new Error("success.checks must be a non-empty array.");
		}
		const normalized = checks.map((check) => {
			if (!check || typeof check !== "object") throw new Error("Each success.checks entry must be an object.");
			const command = (check as { command?: unknown }).command;
			if (typeof command !== "string" || !command.trim()) {
				throw new Error("Each success.checks entry requires a non-empty command.");
			}
			const expectedExitCode = (check as { expectedExitCode?: unknown }).expectedExitCode;
			if (
				expectedExitCode !== undefined
				&& (typeof expectedExitCode !== "number" || !Number.isFinite(expectedExitCode))
			) {
				throw new Error("success.checks[].expectedExitCode must be a finite number when provided.");
			}
			return {
				command: command.trim(),
				...(typeof expectedExitCode === "number" ? { expectedExitCode: Math.trunc(expectedExitCode) } : {}),
				...(typeof (check as { stdoutIncludes?: unknown }).stdoutIncludes === "string"
					? { stdoutIncludes: (check as { stdoutIncludes: string }).stdoutIncludes }
					: {}),
				...(typeof (check as { stdoutExcludes?: unknown }).stdoutExcludes === "string"
					? { stdoutExcludes: (check as { stdoutExcludes: string }).stdoutExcludes }
					: {}),
				...(typeof (check as { stderrIncludes?: unknown }).stderrIncludes === "string"
					? { stderrIncludes: (check as { stderrIncludes: string }).stderrIncludes }
					: {}),
				...(typeof (check as { stderrExcludes?: unknown }).stderrExcludes === "string"
					? { stderrExcludes: (check as { stderrExcludes: string }).stderrExcludes }
					: {}),
			};
		});
		return { mode, checks: normalized };
	}

	if (mode === "qualitative") {
		const allowStandalone = (override as { allowStandalone?: unknown }).allowStandalone;
		const notes = (override as { notes?: unknown }).notes;
		return {
			mode,
			...(typeof allowStandalone === "boolean" ? { allowStandalone } : {}),
			...(typeof notes === "string" ? { notes } : {}),
		};
	}

	if (mode === "hybrid") {
		const deterministic = (override as { deterministic?: unknown }).deterministic;
		const quantitative = (override as { quantitative?: unknown }).quantitative;
		const qualitative = (override as { qualitative?: unknown }).qualitative;
		if (!deterministic && !quantitative && !qualitative) {
			throw new Error("success.hybrid requires at least one of deterministic, quantitative, or qualitative.");
		}
		return {
			mode,
			...(deterministic
				? {
					deterministic: {
						mustFail: toStringArray((deterministic as { mustFail?: unknown }).mustFail, "deterministic.mustFail"),
						mustPass: toStringArray((deterministic as { mustPass?: unknown }).mustPass, "deterministic.mustPass"),
					},
				}
				: {}),
			...(quantitative
				? {
					quantitative: {
						checks: parseSuccessConfig({ mode: "quantitative", checks: (quantitative as { checks?: unknown }).checks }).checks,
					},
				}
				: {}),
			...(qualitative
				? {
					qualitative: {
						...(typeof (qualitative as { allowStandalone?: unknown }).allowStandalone === "boolean"
							? { allowStandalone: (qualitative as { allowStandalone: boolean }).allowStandalone }
							: {}),
						...(typeof (qualitative as { notes?: unknown }).notes === "string"
							? { notes: (qualitative as { notes: string }).notes }
							: {}),
					},
				}
				: {}),
		};
	}

	throw new Error("success.mode must be one of deterministic-tdd, quantitative, hybrid, qualitative.");
}

function mergeRunConfig(base: RalphRunConfig, override: unknown): RalphRunConfig {
	if (!override || typeof override !== "object") return base;
	const candidate = override as Partial<RalphRunConfig>;
	return {
		task: typeof candidate.task === "string" ? candidate.task : base.task,
		maxLoops: typeof candidate.maxLoops === "number" && Number.isFinite(candidate.maxLoops)
			? Math.max(1, Math.floor(candidate.maxLoops))
			: base.maxLoops,
		budget: {
			contextThresholdPercent:
				typeof candidate.budget?.contextThresholdPercent === "number"
					? candidate.budget.contextThresholdPercent
					: base.budget.contextThresholdPercent,
			maxAssistantTurns:
				typeof candidate.budget?.maxAssistantTurns === "number" || candidate.budget?.maxAssistantTurns === null
					? candidate.budget.maxAssistantTurns
					: base.budget.maxAssistantTurns,
			maxToolCalls:
				typeof candidate.budget?.maxToolCalls === "number" || candidate.budget?.maxToolCalls === null
					? candidate.budget.maxToolCalls
					: base.budget.maxToolCalls,
		},
		success: candidate.success === undefined ? base.success : parseSuccessConfig(candidate.success),
		runner: {
			cwd: typeof candidate.runner?.cwd === "string" ? candidate.runner.cwd : base.runner.cwd,
			model: typeof candidate.runner?.model === "string" || candidate.runner?.model === null
				? candidate.runner.model
				: base.runner.model,
			tools: Array.isArray(candidate.runner?.tools)
				? candidate.runner.tools.filter((value): value is string => typeof value === "string")
				: base.runner.tools,
			tmuxSessionPrefix:
				typeof candidate.runner?.tmuxSessionPrefix === "string"
					? candidate.runner.tmuxSessionPrefix
					: base.runner.tmuxSessionPrefix,
			modelContextWindowTokens:
				typeof candidate.runner?.modelContextWindowTokens === "number"
					? Math.max(1, Math.floor(candidate.runner.modelContextWindowTokens))
					: base.runner.modelContextWindowTokens,
		},
	};
}

function presetConfig(base: RalphRunConfig, preset: string): RalphRunConfig {
	switch (preset) {
		case "deterministic-tdd":
			return {
				...base,
				success: {
					mode: "deterministic-tdd",
					mustFail: ["echo 'configure mustFail commands' && exit 1"],
					mustPass: ["echo 'configure mustPass commands' && exit 1"],
				},
			};
		case "quantitative-only":
			return {
				...base,
				success: {
					mode: "quantitative",
					checks: [{ command: "echo 'configure quantitative checks' && exit 1" }],
				},
			};
		case "hybrid":
			return {
				...base,
				success: {
					mode: "hybrid",
					deterministic: {
						mustFail: ["echo 'configure mustFail commands' && exit 1"],
						mustPass: ["echo 'configure mustPass commands' && exit 1"],
					},
					quantitative: {
						checks: [{ command: "echo 'configure quantitative checks' && exit 1" }],
					},
					qualitative: { allowStandalone: false },
				},
			};
		default:
			return base;
	}
}

function parseStartConfig(args: string, cwd: string, base: RalphRunConfig): RalphRunConfig {
	const trimmed = args.trim();
	if (!trimmed) return base;

	const [first, ...rest] = trimmed.split(/\s+/);
	if (first === "deterministic-tdd" || first === "quantitative-only" || first === "hybrid") {
		const withPreset = presetConfig(base, first);
		if (rest.length === 0) return withPreset;
		const inline = rest.join(" ").trim();
		if (!inline.startsWith("{")) {
			throw new Error("Preset overrides must be inline JSON.");
		}
		return mergeRunConfig(withPreset, JSON.parse(inline));
	}

	if (trimmed.startsWith("{")) {
		return mergeRunConfig(base, JSON.parse(trimmed));
	}

	const configPath = resolve(cwd, trimmed);
	if (!existsSync(configPath)) {
		throw new Error(`Config file not found: ${configPath}`);
	}
	return mergeRunConfig(base, JSON.parse(readFileSync(configPath, "utf8")));
}

function findTargetRunId(runtime: RalphRuntime, requestedRunId: string): string | undefined {
	if (requestedRunId) return requestedRunId;
	if (runtime.latestRunId) return runtime.latestRunId;
	const active = Array.from(runtime.activeRuns.keys()).at(-1);
	if (active) return active;
	return runtime.store.listRuns(1)[0]?.runId;
}

function formatRunState(state: RalphRunState): string {
	return state.replaceAll("_", " ");
}

function formatStatus(runtime: RalphRuntime, runId: string): string {
	const run = runtime.store.getRun(runId);
	if (!run) return `Ralph run ${runId} not found`;
	const latestLoop = runtime.store.getLatestLoop(runId);
	const latestEval = runtime.store.getLatestEvent(runId, "success_evaluated");
	let thresholdSummary = "n/a";
	try {
		const parsedConfig = JSON.parse(run.configJson) as RalphRunConfig;
		thresholdSummary = `ctx ${parsedConfig.budget.contextThresholdPercent}%`
			+ `, turns ${parsedConfig.budget.maxAssistantTurns ?? "off"}`
			+ `, tools ${parsedConfig.budget.maxToolCalls ?? "off"}`;
	} catch {
		thresholdSummary = "invalid config";
	}
	let evalSummary = "n/a";
	if (latestEval) {
		try {
			const payload = JSON.parse(latestEval.payloadJson) as { status?: string; reason?: string };
			evalSummary = `${payload.status ?? "unknown"}${payload.reason ? ` (${payload.reason})` : ""}`;
		} catch {
			evalSummary = "invalid payload";
		}
	}
	const childHealth = runtime.activeRuns.has(runId) ? "active" : "inactive";
	return [
		`run: ${run.runId}`,
		`state: ${formatRunState(run.state)}`,
		`loop: ${run.activeLoop}/${run.maxLoops}`,
		`thresholds: ${thresholdSummary}`,
		`latest trigger: ${latestLoop?.triggerReason ?? "n/a"}`,
		`last evaluator: ${evalSummary}`,
		`tmux child: ${childHealth}`,
	].join("\n");
}

function setUiStatus(
	ctx: ExtensionCommandContext | { hasUI: boolean; ui: { setStatus: (key: string, text: string | undefined) => void } },
	runtime: RalphRuntime,
): void {
	if (!ctx.hasUI) return;
	const runId = findTargetRunId(runtime, "");
	if (!runId) {
		ctx.ui.setStatus("ralph", "Ralph idle");
		return;
	}
	const run = runtime.store.getRun(runId);
	if (!run) {
		ctx.ui.setStatus("ralph", "Ralph idle");
		return;
	}
	const child = runtime.activeRuns.has(runId) ? "active" : "idle";
	ctx.ui.setStatus("ralph", `Ralph ${formatRunState(run.state)} • loop ${run.activeLoop}/${run.maxLoops} • child ${child}`);
}

function respond(pi: ExtensionAPI, ctx: ExtensionCommandContext, result: RalphActionResult): void {
	if (ctx.hasUI) {
		ctx.ui.notify(result.message, result.level);
		return;
	}
	pi.sendUserMessage(result.message);
}

function toToolResult(result: RalphActionResult) {
	return {
		content: [{ type: "text" as const, text: result.message }],
		details: { ok: result.ok, level: result.level, ...result.details },
		isError: result.level === "error",
	};
}

export default function ralphLoopExtension(pi: ExtensionAPI): void {
	let runtime: RalphRuntime | null = null;

	function ensureRuntime(cwd: string): RalphRuntime | null {
		const config = resolveRalphConfig(cwd);
		if (!config.enabled) return null;

		if (!runtime || runtime.configDbPath !== config.dbPath) {
			if (runtime) {
				for (const active of runtime.activeRuns.values()) active.controller.abort();
				runtime.activeRuns.clear();
			}
			runtime = {
				store: new RalphStore(getRalphDb(config.dbPath)),
				configDbPath: config.dbPath,
				defaultRun: config.defaultRun,
				activeRuns: new Map(),
				latestRunId: null,
			};
		} else {
			runtime.defaultRun = config.defaultRun;
		}
		return runtime;
	}

	function runConfigFromToolParams(params: RalphToolParams, cwd: string, base: RalphRunConfig): RalphRunConfig {
		let resolved = mergeRunConfig(base, { runner: { cwd } });
		if (params.preset) {
			resolved = presetConfig(resolved, params.preset);
		}
		const override = {
			...(params.task !== undefined ? { task: params.task } : {}),
			...(params.maxLoops !== undefined ? { maxLoops: params.maxLoops } : {}),
			...(params.budget !== undefined ? { budget: params.budget } : {}),
			...(params.success !== undefined ? { success: params.success } : {}),
			...(params.runner !== undefined ? { runner: params.runner } : {}),
		};
		return mergeRunConfig(resolved, override);
	}

	function startRun(current: RalphRuntime, runConfig: RalphRunConfig): RalphActionResult {
		if (!runConfig.task.trim()) {
			return {
				ok: false,
				level: "error",
				message: "Ralph start requires a non-empty task (set task in config or inline JSON).",
			};
		}

		const controller = new AbortController();
		const run = startRalphRun({
			store: current.store,
			config: runConfig,
			signal: controller.signal,
		});
		current.activeRuns.set(run.runId, { runId: run.runId, controller });
		current.latestRunId = run.runId;

		void run.completion
			.catch(() => {
				current.store.updateRunState(run.runId, "failed", Date.now());
			})
			.finally(() => {
				current.activeRuns.delete(run.runId);
			});

		return {
			ok: true,
			level: "info",
			message: `Started Ralph run ${run.runId}`,
			details: { runId: run.runId },
		};
	}

	function actionStartFromCommand(cwd: string, args: string): RalphActionResult {
		const current = ensureRuntime(cwd);
		if (!current) {
			return {
				ok: false,
				level: "error",
				message: "Ralph loop is disabled. Set PI_RALPH_ENABLED=1 or enable in .pi/ralph-loop.json.",
			};
		}

		let runConfig: RalphRunConfig;
		try {
			runConfig = parseStartConfig(args, cwd, mergeRunConfig(current.defaultRun, { runner: { cwd } }));
		} catch (error) {
			return {
				ok: false,
				level: "error",
				message: `Invalid Ralph config: ${error instanceof Error ? error.message : String(error)}`,
			};
		}

		return startRun(current, runConfig);
	}

	function actionStartFromTool(params: RalphToolParams): RalphActionResult {
		const cwd = typeof params.cwd === "string" && params.cwd.trim() ? params.cwd : process.cwd();
		const current = ensureRuntime(cwd);
		if (!current) {
			return { ok: false, level: "error", message: "Ralph loop is disabled." };
		}

		let runConfig: RalphRunConfig;
		try {
			runConfig = runConfigFromToolParams(params, cwd, current.defaultRun);
		} catch (error) {
			return {
				ok: false,
				level: "error",
				message: `Invalid Ralph config: ${error instanceof Error ? error.message : String(error)}`,
			};
		}
		return startRun(current, runConfig);
	}

	function actionStop(cwd: string, requestedRunId: string): RalphActionResult {
		const current = ensureRuntime(cwd);
		if (!current) return { ok: false, level: "error", message: "Ralph loop is disabled." };
		const runId = findTargetRunId(current, requestedRunId.trim());
		if (!runId) return { ok: false, level: "warning", message: "No Ralph run available to stop." };
		const active = current.activeRuns.get(runId);
		if (!active) return { ok: false, level: "warning", message: `Run ${runId} is not active in this session.` };
		active.controller.abort();
		return { ok: true, level: "warning", message: `Stop signal sent for ${runId}`, details: { runId } };
	}

	function actionStatus(cwd: string, requestedRunId: string): RalphActionResult {
		const current = ensureRuntime(cwd);
		if (!current) return { ok: false, level: "error", message: "Ralph loop is disabled." };
		const runId = findTargetRunId(current, requestedRunId.trim());
		if (!runId) return { ok: false, level: "warning", message: "No Ralph runs found." };
		return { ok: true, level: "info", message: formatStatus(current, runId), details: { runId } };
	}

	function actionRuns(cwd: string, limit: number): RalphActionResult {
		const current = ensureRuntime(cwd);
		if (!current) return { ok: false, level: "error", message: "Ralph loop is disabled." };
		const normalizedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 10;
		const runs = current.store.listRuns(normalizedLimit);
		if (runs.length === 0) {
			return { ok: true, level: "info", message: "No Ralph runs found.", details: { count: 0 } };
		}
		const lines = runs.map((run) => {
			const snippet = run.task.length > 50 ? `${run.task.slice(0, 47)}...` : run.task;
			return `${run.runId} • ${formatRunState(run.state)} • loop ${run.activeLoop}/${run.maxLoops} • ${snippet}`;
		});
		return { ok: true, level: "info", message: lines.join("\n"), details: { count: runs.length } };
	}

	pi.registerTool({
		name: "ralph_loop",
		label: "ralph_loop",
		description: "Control Ralph loop runs. Actions: start, stop, status, runs.",
		parameters: RalphToolParamsSchema,
		execute: async (_id, rawParams) => {
			const params = rawParams as RalphToolParams;
			const cwd = typeof params.cwd === "string" && params.cwd.trim() ? params.cwd : process.cwd();
			const action = params.action;
			if (action === "start") return toToolResult(actionStartFromTool(params));
			if (action === "stop") return toToolResult(actionStop(cwd, typeof params.runId === "string" ? params.runId : ""));
			if (action === "status") return toToolResult(actionStatus(cwd, typeof params.runId === "string" ? params.runId : ""));
			if (action === "runs") return toToolResult(actionRuns(cwd, typeof params.limit === "number" ? params.limit : 10));
			return toToolResult({ ok: false, level: "error", message: `Unknown action '${String((params as any).action)}'.` });
		},
	});

	pi.registerCommand("ralph-start", {
		description: "Start a Ralph loop run (/ralph-start <config-or-preset>)",
		handler: async (args, ctx) => {
			const result = actionStartFromCommand(ctx.cwd, args);
			respond(pi, ctx, result);
			if (runtime) setUiStatus(ctx, runtime);
		},
	});

	pi.registerCommand("ralph-stop", {
		description: "Stop a Ralph run (/ralph-stop [runId])",
		handler: async (args, ctx) => {
			const result = actionStop(ctx.cwd, args);
			respond(pi, ctx, result);
			if (runtime) setUiStatus(ctx, runtime);
		},
	});

	pi.registerCommand("ralph-status", {
		description: "Show Ralph run status (/ralph-status [runId])",
		handler: async (args, ctx) => {
			const result = actionStatus(ctx.cwd, args);
			respond(pi, ctx, result);
			if (runtime) setUiStatus(ctx, runtime);
		},
	});

	pi.registerCommand("ralph-runs", {
		description: "List recent Ralph runs (/ralph-runs)",
		handler: async (_args, ctx) => {
			const result = actionRuns(ctx.cwd, 10);
			respond(pi, ctx, result);
			if (runtime) setUiStatus(ctx, runtime);
		},
	});

	pi.on("session_start", (_event, ctx) => {
		const current = ensureRuntime(ctx.cwd);
		if (!current) return;
		if (ctx.hasUI) ctx.ui.setStatus("ralph", "Ralph idle");
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (runtime) {
			for (const active of runtime.activeRuns.values()) active.controller.abort();
			runtime.activeRuns.clear();
		}
		if (ctx.hasUI) ctx.ui.setStatus("ralph", undefined);
	});
}
