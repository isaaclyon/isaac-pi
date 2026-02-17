import type {
	ExecResult,
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	ToolCallEvent,
	ToolResultEvent,
} from "@mariozechner/pi-coding-agent";

/**
 * Standard lifecycle hooks with script slots.
 *
 * Hooks can run configured actions and auto-discovered scripts.
 * Script discovery order:
 *   1) packaged defaults in isaac-pi: .pi/scripts/<hook-name>/
 *   2) project overrides in cwd:     .pi/scripts/<hook-name>/
 * Project scripts with the same filename override packaged defaults.
 *
 * Create .pi/standard-hooks.json (optional):
 * {
 *   "startupNotify": true,
 *   "skillsReminder": { "enabled": true },
 *   "usePackageDefaults": true,
 *   "scriptsRoot": ".pi/scripts",
 *   "hooks": {
 *     "session_start": "lint, format:check",
 *     "input": [
 *       {
 *         "sendMessage": {
 *           "content": "User said: {text}",
 *           "customType": "standard-hooks",
 *           "display": false
 *         },
 *         "when": { "inputSources": ["interactive"] }
 *       },
 *       {
 *         "run": "echo new user input",
 *         "when": { "inputSources": ["interactive"], "includesText": ["deploy"] }
 *       }
 *     ],
 *     "tool_call": [
 *       {
 *         "run": "echo pre tool",
 *         "when": { "toolNames": ["bash"], "includesText": ["git "] }
 *       }
 *     ],
 *     "tool_result": [
 *       { "run": "echo tool finished", "when": { "onlyWhenToolError": true } }
 *     ],
 *     "agent_end": ["typecheck", "test:quick"]
 *   }
 * }
 */
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

type HookName = "session_start" | "input" | "tool_call" | "tool_result" | "agent_end";
const HOOK_NAMES: HookName[] = ["session_start", "input", "tool_call", "tool_result", "agent_end"];
const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));
const PACKAGE_HOOKS_ROOT = resolve(EXTENSION_DIR, "..", "scripts");
const DEFAULT_SKILLS_REMINDER = "Before responding, consider which of your available skills could improve your output. Invoke those skills now if relevant, then respond. If none seem relevant, do not invoke them, and just respond as usual.";

type HookScriptInput = string | HookScriptConfig | Array<string | HookScriptConfig>;

type FailureMode = "ignore" | "warn" | "block";
type UserInputSource = "interactive" | "rpc" | "extension";

interface HookScriptMatcher {
	toolNames?: string[];
	inputSources?: UserInputSource[];
	includesText?: string[];
	excludesText?: string[];
	commandRegex?: string;
	onlyWhenToolError?: boolean;
}

interface HookScriptConfig {
	id?: string;
	/**
	 * Quick mode:
	 * - "typecheck" -> npm run typecheck
	 * - "npm run lint" -> sh -lc "npm run lint"
	 */
	run?: string;
	command?: string;
	args?: string[];
	/** Path to script file (relative to repo root or absolute). */
	scriptPath?: string;
	cwd?: string;
	timeoutMs?: number;
	when?: HookScriptMatcher;
	onFailure?: FailureMode;
	/**
	 * Inject a custom message into the session.
	 * Supports templates: {hook}, {source}, {toolName}, {text}, {isError}
	 */
	sendMessage?: {
		content: string;
		customType?: string;
		display?: boolean;
		triggerTurn?: boolean;
		deliverAs?: "steer" | "followUp" | "nextTurn";
	};
	/**
	 * Send a user message (triggers a turn). Use carefully to avoid loops.
	 * Supports templates: {hook}, {source}, {toolName}, {text}, {isError}
	 */
	sendUserMessage?: {
		content: string;
		deliverAs?: "steer" | "followUp";
	};
}

interface StandardHooksConfig {
	enabled?: boolean;
	startupNotify?: boolean;
	strict?: boolean;
	skillsReminder?: {
		enabled?: boolean;
		text?: string;
	};
	guard?: {
		blockDangerousBash?: boolean;
		dangerousPatterns?: string[];
		allowPatterns?: string[];
	};
	agentEnd?: {
		cooldownMs?: number;
		skipIfToolErrors?: boolean;
		skipIfPendingMessages?: boolean;
		defaultTimeoutMs?: number;
		notifyOnSuccess?: boolean;
		notifyOnFailure?: boolean;
	};
	/** Auto-run scripts found in hooks directories. */
	autoRunScriptDirs?: boolean;
	/** Also run packaged defaults from isaac-pi itself. */
	usePackageDefaults?: boolean;
	/** Base dir for project hook scripts. Defaults to .pi/scripts */
	scriptsRoot?: string;
	/** Optional per-hook project directory overrides. */
	scriptDirs?: Partial<Record<HookName, string>>;
	hooks?: Partial<Record<HookName, HookScriptInput>>;
}

interface RequestState {
	startedAt: number;
	toolCalls: number;
	toolErrors: number;
}

interface SessionState {
	configPath: string;
	config: StandardHooksConfig;
	hookPlans: Record<HookName, HookScriptConfig[]>;
	request: RequestState;
	totalToolCalls: number;
	totalToolErrors: number;
	recentToolCalls: Array<{ tool: string; at: number; preview: string }>;
	recentErrors: Array<{ tool: string; at: number; preview: string }>;
	lastAgentEndRunAt: number;
	agentEndRunInFlight: boolean;
}

interface FailedHookCheck {
	label: string;
	summary: string;
	code: number;
	killed: boolean;
}

const DEFAULT_CONFIG: StandardHooksConfig = {
	enabled: true,
	startupNotify: false,
	strict: false,
	skillsReminder: {
		enabled: true,
		text: DEFAULT_SKILLS_REMINDER,
	},
	guard: {
		blockDangerousBash: true,
		dangerousPatterns: [
			"rm -rf /",
			"sudo rm -rf",
			"mkfs",
			"dd if=",
			":(){ :|:& };:",
		],
		allowPatterns: [],
	},
	agentEnd: {
		cooldownMs: 2500,
		skipIfToolErrors: false,
		skipIfPendingMessages: true,
		defaultTimeoutMs: 120000,
		notifyOnSuccess: false,
		notifyOnFailure: true,
	},
	autoRunScriptDirs: true,
	usePackageDefaults: true,
	scriptsRoot: ".pi/scripts",
	scriptDirs: {},
	hooks: {},
};

function emptyHookPlans(): Record<HookName, HookScriptConfig[]> {
	return {
		session_start: [],
		input: [],
		tool_call: [],
		tool_result: [],
		agent_end: [],
	};
}

function createInitialState(): SessionState {
	return {
		configPath: "",
		config: DEFAULT_CONFIG,
		hookPlans: emptyHookPlans(),
		request: { startedAt: Date.now(), toolCalls: 0, toolErrors: 0 },
		totalToolCalls: 0,
		totalToolErrors: 0,
		recentToolCalls: [],
		recentErrors: [],
		lastAgentEndRunAt: 0,
		agentEndRunInFlight: false,
	};
}

function pushBounded<T>(arr: T[], value: T, max = 20): void {
	arr.push(value);
	if (arr.length > max) arr.shift();
}

function mergeConfig(base: StandardHooksConfig, incoming?: StandardHooksConfig): StandardHooksConfig {
	if (!incoming) return base;
	return {
		...base,
		...incoming,
		skillsReminder: { ...base.skillsReminder, ...incoming.skillsReminder },
		guard: { ...base.guard, ...incoming.guard },
		agentEnd: { ...base.agentEnd, ...incoming.agentEnd },
		scriptDirs: { ...base.scriptDirs, ...incoming.scriptDirs },
		hooks: { ...base.hooks, ...incoming.hooks },
	};
}

function loadConfig(cwd: string): { config: StandardHooksConfig; path: string } {
	const configPath = resolve(join(cwd, ".pi", "standard-hooks.json"));
	if (!existsSync(configPath)) {
		return { config: DEFAULT_CONFIG, path: configPath };
	}

	try {
		const raw = readFileSync(configPath, "utf8");
		const parsed = JSON.parse(raw) as StandardHooksConfig;
		return { config: mergeConfig(DEFAULT_CONFIG, parsed), path: configPath };
	} catch {
		return { config: DEFAULT_CONFIG, path: configPath };
	}
}

function normalizeHookScripts(input: HookScriptInput | undefined): HookScriptConfig[] {
	if (!input) return [];

	const asArray = Array.isArray(input) ? input : [input];
	const out: HookScriptConfig[] = [];

	for (const item of asArray) {
		if (typeof item === "string") {
			for (const chunk of item.split(",").map((v) => v.trim()).filter(Boolean)) {
				out.push({ run: chunk });
			}
			continue;
		}
		out.push(item);
	}

	return out;
}

function resolveProjectHookDir(cwd: string, hook: HookName, config: StandardHooksConfig): string {
	const hookDir = config.scriptDirs?.[hook] ?? join(config.scriptsRoot ?? ".pi/scripts", hook);
	return resolve(cwd, hookDir);
}

function discoverScriptsAtDir(hook: HookName, dir: string, idPrefix: string): HookScriptConfig[] {
	if (!existsSync(dir)) return [];

	const files = readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && !entry.name.startsWith("."))
		.map((entry) => entry.name)
		.sort((a, b) => a.localeCompare(b));

	return files.map((name) => ({
		id: `${idPrefix}:${hook}:${name}`,
		scriptPath: join(dir, name),
	}));
}

function mergeScriptLists(packageScripts: HookScriptConfig[], projectScripts: HookScriptConfig[]): HookScriptConfig[] {
	if (packageScripts.length === 0) return projectScripts;
	if (projectScripts.length === 0) return packageScripts;

	const projectByName = new Set(projectScripts.map((script) => basename(script.scriptPath ?? "")));
	const filteredPackage = packageScripts.filter((script) => !projectByName.has(basename(script.scriptPath ?? "")));
	return [...filteredPackage, ...projectScripts];
}

function discoverHookScripts(cwd: string, hook: HookName, config: StandardHooksConfig): HookScriptConfig[] {
	if (!(config.autoRunScriptDirs ?? true)) return [];

	const packageScripts = (config.usePackageDefaults ?? true)
		? discoverScriptsAtDir(hook, resolve(PACKAGE_HOOKS_ROOT, hook), "pkg")
		: [];
	const projectScripts = discoverScriptsAtDir(hook, resolveProjectHookDir(cwd, hook, config), "project");

	return mergeScriptLists(packageScripts, projectScripts);
}

function buildHookPlans(cwd: string, config: StandardHooksConfig): Record<HookName, HookScriptConfig[]> {
	const plans = emptyHookPlans();

	for (const hook of HOOK_NAMES) {
		plans[hook] = [
			...normalizeHookScripts(config.hooks?.[hook]),
			...discoverHookScripts(cwd, hook, config),
		];
	}

	return plans;
}

function getPreviewFromToolCall(event: ToolCallEvent): string {
	if (isToolCallEventType("bash", event)) return event.input.command;
	try {
		return JSON.stringify(event.input).slice(0, 180);
	} catch {
		return "[unserializable tool input]";
	}
}

function getPreviewFromToolResult(event: ToolResultEvent): string {
	if (event.toolName === "bash" && typeof event.input.command === "string") return event.input.command;
	const text = event.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join("\n");
	return text.slice(0, 180);
}

function getPreviewFromInput(event: InputEvent): string {
	return event.text.slice(0, 180);
}

function matchesScript(
	script: HookScriptConfig,
	meta: { toolName?: string; source?: UserInputSource; text?: string; isError?: boolean },
): boolean {
	const when = script.when;
	if (!when) return true;

	if (when.toolNames?.length && (!meta.toolName || !when.toolNames.includes(meta.toolName))) return false;
	if (when.inputSources?.length && (!meta.source || !when.inputSources.includes(meta.source))) return false;
	if (when.onlyWhenToolError && !meta.isError) return false;

	const haystack = meta.text ?? "";
	if (when.includesText?.length && !when.includesText.every((needle) => haystack.includes(needle))) {
		return false;
	}
	if (when.excludesText?.length && when.excludesText.some((needle) => haystack.includes(needle))) {
		return false;
	}
	if (when.commandRegex) {
		try {
			if (!new RegExp(when.commandRegex, "i").test(haystack)) return false;
		} catch {
			return false;
		}
	}

	return true;
}

function resolveExecSpec(script: HookScriptConfig, cwd: string): { command: string; args: string[]; label: string } | undefined {
	if (script.scriptPath) {
		const fullPath = resolve(cwd, script.scriptPath);
		const ext = extname(fullPath).toLowerCase();
		const label = `script ${basename(fullPath)}`;
		if (ext === ".js" || ext === ".mjs" || ext === ".cjs") {
			return { command: "node", args: [fullPath], label };
		}
		if (ext === ".py") {
			return { command: "python3", args: [fullPath], label };
		}
		return { command: "sh", args: [fullPath], label };
	}

	if (script.command) {
		return {
			command: script.command,
			args: script.args ?? [],
			label: `${script.command} ${(script.args ?? []).join(" ")}`.trim(),
		};
	}

	const run = script.run?.trim();
	if (!run) return undefined;

	if (!run.includes(" ")) {
		return {
			command: "npm",
			args: ["run", run, "--if-present"],
			label: `npm run ${run}`,
		};
	}

	return {
		command: "sh",
		args: ["-lc", run],
		label: run,
	};
}

function getFailureMode(script: HookScriptConfig, strict = false): FailureMode {
	if (script.onFailure) return script.onFailure;
	return strict ? "block" : "warn";
}

function notify(ctx: ExtensionContext, message: string, type: "info" | "warning" | "error" = "info"): void {
	if (!ctx.hasUI) return;
	ctx.ui.notify(message, type);
}

function fillTemplate(
	template: string,
	hook: HookName,
	meta: { toolName?: string; source?: UserInputSource; text?: string; isError?: boolean },
): string {
	return template
		.replaceAll("{hook}", hook)
		.replaceAll("{toolName}", meta.toolName ?? "")
		.replaceAll("{source}", meta.source ?? "")
		.replaceAll("{text}", meta.text ?? "")
		.replaceAll("{isError}", String(Boolean(meta.isError)));
}

function summarizeExecFailure(result: ExecResult): string {
	const source = result.stderr.trim() || result.stdout.trim();
	if (!source) {
		return result.killed ? "Process was terminated (timeout or cancellation)." : `Exited with code ${result.code}.`;
	}

	const lines = source.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.length > 0);
	const tail = lines.slice(-6).join("\n");
	const maxChars = 500;
	if (tail.length <= maxChars) return tail;
	return `…${tail.slice(-(maxChars - 1))}`;
}

function formatFailedChecksMessage(failedChecks: FailedHookCheck[]): string {
	const header = `Quality checks failed (${failedChecks.length}):`;
	const items = failedChecks.map((check) => {
		const oneLine = check.summary.replace(/\s+/g, " ").trim();
		const snippet = oneLine.length > 180 ? `${oneLine.slice(0, 177)}...` : oneLine;
		return `- ${check.label}: ${snippet}`;
	});
	return [header, ...items].join("\n");
}

function getSkillsReminder(config: StandardHooksConfig): string | undefined {
	if (!(config.skillsReminder?.enabled ?? true)) return undefined;
	const text = config.skillsReminder?.text?.trim();
	return text && text.length > 0 ? text : DEFAULT_SKILLS_REMINDER;
}

export default function standardHooks(pi: ExtensionAPI): void {
	const state = createInitialState();

	pi.on("session_start", async (_event, ctx) => {
		const loaded = loadConfig(ctx.cwd);
		state.config = loaded.config;
		state.configPath = loaded.path;
		state.hookPlans = buildHookPlans(ctx.cwd, state.config);
		state.request = { startedAt: Date.now(), toolCalls: 0, toolErrors: 0 };

		if (!state.config.enabled) return;
		if (state.config.startupNotify) {
			notify(ctx, `standard-hooks loaded (${state.configPath})`, "info");
		}

		await runHookScripts(pi, state, "session_start", ctx, {});
	});

	pi.on("agent_start", () => {
		state.request = { startedAt: Date.now(), toolCalls: 0, toolErrors: 0 };
	});

	pi.on("before_agent_start", (event) => {
		if (!state.config.enabled) return;
		const reminder = getSkillsReminder(state.config);
		if (!reminder) return;
		if (event.systemPrompt.includes(reminder)) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${reminder}`,
		};
	});

	pi.on("input", async (event, ctx) => {
		if (!state.config.enabled) return;

		const preview = getPreviewFromInput(event);
		const scriptOutcome = await runHookScripts(pi, state, "input", ctx, {
			source: event.source,
			text: preview,
			isError: false,
		});

		if (scriptOutcome.shouldBlock) {
			notify(ctx, scriptOutcome.reason ?? "Input blocked by standard-hooks policy", "warning");
			return { action: "handled" as const };
		}
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!state.config.enabled) return;

		const preview = getPreviewFromToolCall(event);
		state.totalToolCalls += 1;
		state.request.toolCalls += 1;
		pushBounded(state.recentToolCalls, { tool: event.toolName, at: Date.now(), preview }, 30);

		if (isToolCallEventType("bash", event) && (state.config.guard?.blockDangerousBash ?? true)) {
			const command = event.input.command;
			const allowPatterns = state.config.guard?.allowPatterns ?? [];
			const explicitlyAllowed = allowPatterns.some((pattern) => {
				try {
					return new RegExp(pattern, "i").test(command);
				} catch {
					return false;
				}
			});

			if (!explicitlyAllowed) {
				const dangerousPatterns = state.config.guard?.dangerousPatterns ?? [];
				const hasDangerousPattern = dangerousPatterns.some((pattern) => command.toLowerCase().includes(pattern.toLowerCase()));
				if (hasDangerousPattern) {
					return { block: true, reason: "Blocked by standard-hooks bash safety policy" };
				}
			}
		}

		const scriptOutcome = await runHookScripts(pi, state, "tool_call", ctx, {
			toolName: event.toolName,
			text: preview,
			isError: false,
		});

		if (scriptOutcome.shouldBlock) {
			return { block: true, reason: scriptOutcome.reason ?? "Blocked by standard-hooks policy" };
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!state.config.enabled) return;

		const preview = getPreviewFromToolResult(event);
		if (event.isError) {
			state.totalToolErrors += 1;
			state.request.toolErrors += 1;
			pushBounded(state.recentErrors, { tool: event.toolName, at: Date.now(), preview }, 30);
		}

		await runHookScripts(pi, state, "tool_result", ctx, {
			toolName: event.toolName,
			text: preview,
			isError: event.isError,
		});
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!state.config.enabled) return;
		if (state.agentEndRunInFlight) return;

		const now = Date.now();
		const cooldownMs = state.config.agentEnd?.cooldownMs ?? 2500;
		if (now - state.lastAgentEndRunAt < cooldownMs) return;
		if ((state.config.agentEnd?.skipIfPendingMessages ?? true) && ctx.hasPendingMessages()) return;
		if ((state.config.agentEnd?.skipIfToolErrors ?? false) && state.request.toolErrors > 0) return;

		state.agentEndRunInFlight = true;
		state.lastAgentEndRunAt = now;

		void runHookScripts(pi, state, "agent_end", ctx, {}).then((outcome) => {
			if (outcome.failedCount > 0 && (state.config.agentEnd?.notifyOnFailure ?? true)) {
				notify(ctx, `standard-hooks: ${outcome.failedCount} agent_end check(s) failed`, "warning");
				pi.sendMessage({
					customType: "standard-hooks",
					content: formatFailedChecksMessage(outcome.failedChecks),
					display: true,
				});
			} else if (outcome.ranCount > 0 && (state.config.agentEnd?.notifyOnSuccess ?? false)) {
				notify(ctx, `standard-hooks: ${outcome.ranCount} agent_end check(s) passed`, "info");
			}

			pi.appendEntry("standard-hooks:agent-end", {
				at: Date.now(),
				ranCount: outcome.ranCount,
				failedCount: outcome.failedCount,
				failedLabels: outcome.failedLabels,
				failedChecks: outcome.failedChecks,
				toolCalls: state.request.toolCalls,
				toolErrors: state.request.toolErrors,
			});
		}).finally(() => {
			state.agentEndRunInFlight = false;
		});
	});
}

async function runHookScripts(
	pi: ExtensionAPI,
	state: SessionState,
	hook: HookName,
	ctx: ExtensionContext,
	meta: { toolName?: string; source?: UserInputSource; text?: string; isError?: boolean },
): Promise<{
	shouldBlock: boolean;
	reason?: string;
	ranCount: number;
	failedCount: number;
	failedLabels: string[];
	failedChecks: FailedHookCheck[];
}> {
	const scripts = state.hookPlans[hook] ?? [];
	if (scripts.length === 0) return { shouldBlock: false, ranCount: 0, failedCount: 0, failedLabels: [], failedChecks: [] };

	let shouldBlock = false;
	let blockReason: string | undefined;
	let ranCount = 0;
	let failedCount = 0;
	const failedLabels: string[] = [];
	const failedChecks: FailedHookCheck[] = [];

	for (const script of scripts) {
		if (!matchesScript(script, meta)) continue;

		if (script.sendMessage) {
			ranCount += 1;
			pi.sendMessage({
				customType: script.sendMessage.customType ?? "standard-hooks",
				content: fillTemplate(script.sendMessage.content, hook, meta),
				display: script.sendMessage.display ?? false,
			}, {
				triggerTurn: script.sendMessage.triggerTurn,
				deliverAs: script.sendMessage.deliverAs,
			});
			continue;
		}

		if (script.sendUserMessage) {
			if (hook === "input" && meta.source === "extension") continue;
			ranCount += 1;
			pi.sendUserMessage(fillTemplate(script.sendUserMessage.content, hook, meta), {
				deliverAs: script.sendUserMessage.deliverAs,
			});
			continue;
		}

		const execSpec = resolveExecSpec(script, ctx.cwd);
		if (!execSpec) continue;
		ranCount += 1;

		const timeoutMs = script.timeoutMs ?? state.config.agentEnd?.defaultTimeoutMs ?? 120000;
		const cwd = script.cwd ? resolve(ctx.cwd, script.cwd) : ctx.cwd;
		const result = await pi.exec(execSpec.command, execSpec.args, { timeout: timeoutMs, cwd });

		if (isExecFailure(result)) {
			failedCount += 1;
			failedLabels.push(execSpec.label);
			const summary = summarizeExecFailure(result);
			failedChecks.push({
				label: execSpec.label,
				summary,
				code: result.code,
				killed: result.killed,
			});
			const mode = getFailureMode(script, state.config.strict ?? false);
			if (mode === "warn") {
				notify(ctx, `standard-hooks: failed (${hook}) ${execSpec.label}`, "warning");
			}
			if (mode === "block" && (hook === "tool_call" || hook === "input")) {
				shouldBlock = true;
				blockReason = hook === "input"
					? `Blocked: input hook failed (${execSpec.label})`
					: `Blocked: pre-tool hook failed (${execSpec.label})`;
				break;
			}
		}
	}

	return { shouldBlock, reason: blockReason, ranCount, failedCount, failedLabels, failedChecks };
}

function isExecFailure(result: ExecResult): boolean {
	return result.killed || result.code !== 0;
}
