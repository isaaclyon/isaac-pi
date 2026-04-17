import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ContextUsage, ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

type TriggerPolicy = {
	maxTokens?: number;
	minTokens: number;
	cooldownMs: number;
	builtinReserveTokens: number;
	builtinSkipMarginPercent: number;
};

type UiPolicy = {
	name: string;
	showStatus: boolean;
};

type ProfileOverride = {
	match: string;
	trigger?: Partial<TriggerPolicy>;
	ui?: Partial<UiPolicy>;
};

export type CompactionTriggerPolicy = {
	enabled: boolean;
	trigger: TriggerPolicy;
	ui: UiPolicy;
	summaryRetention?: { mode: "tokens" | "percent"; value: number };
	profiles?: Record<string, ProfileOverride>;
};

export const DEFAULT_POLICY: CompactionTriggerPolicy = {
	enabled: false,
	trigger: {
		minTokens: 100_000,
		cooldownMs: 60_000,
		builtinReserveTokens: 16_384,
		builtinSkipMarginPercent: 5,
	},
	ui: {
		name: "compact",
		showStatus: true,
	},
};

const STATUS_KEY = "lcm-compaction-trigger";
const PROJECT_POLICY_PATH = ".pi/compaction-policy.json";
const GLOBAL_POLICY_PATH = join(homedir(), ".pi", "agent", "compaction-policy.json");

function asObject(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	return value as Record<string, unknown>;
}

function asNonNegativeInteger(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
	if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
	return undefined;
}

function asBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined;
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function parseTriggerPatch(value: unknown): Partial<TriggerPolicy> {
	const raw = asObject(value);
	if (!raw) return {};

	const patch: Partial<TriggerPolicy> = {};
	const maxTokens = asNonNegativeInteger(raw.maxTokens);
	if (maxTokens !== undefined) patch.maxTokens = maxTokens;
	const minTokens = asNonNegativeInteger(raw.minTokens);
	if (minTokens !== undefined) patch.minTokens = minTokens;
	const cooldownMs = asNonNegativeInteger(raw.cooldownMs);
	if (cooldownMs !== undefined) patch.cooldownMs = cooldownMs;
	const builtinReserveTokens = asNonNegativeInteger(raw.builtinReserveTokens);
	if (builtinReserveTokens !== undefined) patch.builtinReserveTokens = builtinReserveTokens;
	const builtinSkipMarginPercent = asNonNegativeInteger(raw.builtinSkipMarginPercent);
	if (builtinSkipMarginPercent !== undefined) patch.builtinSkipMarginPercent = builtinSkipMarginPercent;
	return patch;
}

function parseUiPatch(value: unknown): Partial<UiPolicy> {
	const raw = asObject(value);
	if (!raw) return {};

	const patch: Partial<UiPolicy> = {};
	const name = asString(raw.name);
	if (name) patch.name = name;
	const showStatus = asBoolean(raw.showStatus);
	if (showStatus !== undefined) patch.showStatus = showStatus;
	return patch;
}

function parseProfileOverride(value: unknown): ProfileOverride | undefined {
	const raw = asObject(value);
	if (!raw) return undefined;
	const match = asString(raw.match);
	if (!match) return undefined;
	return {
		match,
		trigger: parseTriggerPatch(raw.trigger),
		ui: parseUiPatch(raw.ui),
	};
}

function parseProfiles(value: unknown): Record<string, ProfileOverride> | undefined {
	const raw = asObject(value);
	if (!raw) return undefined;

	const profiles: Record<string, ProfileOverride> = {};
	for (const [name, profile] of Object.entries(raw)) {
		const parsed = parseProfileOverride(profile);
		if (parsed) profiles[name] = parsed;
	}
	return Object.keys(profiles).length > 0 ? profiles : undefined;
}

function parsePolicy(raw: unknown): CompactionTriggerPolicy {
	const obj = asObject(raw);
	if (!obj) return DEFAULT_POLICY;

	const enabled = asBoolean(obj.enabled) ?? DEFAULT_POLICY.enabled;
	return {
		enabled,
		trigger: { ...DEFAULT_POLICY.trigger, ...parseTriggerPatch(obj.trigger) },
		ui: { ...DEFAULT_POLICY.ui, ...parseUiPatch(obj.ui) },
		summaryRetention: asObject(obj.summaryRetention)
			? {
				mode: obj.summaryRetention.mode === "percent" ? "percent" : "tokens",
				value: asNonNegativeInteger(obj.summaryRetention.value) ?? 0,
			}
			: undefined,
		profiles: parseProfiles(obj.profiles),
	};
}

export function loadCompactionTriggerPolicy(cwd: string): CompactionTriggerPolicy {
	const projectPath = join(cwd, PROJECT_POLICY_PATH);
	const configPath = existsSync(projectPath) ? projectPath : existsSync(GLOBAL_POLICY_PATH) ? GLOBAL_POLICY_PATH : undefined;
	if (!configPath) return DEFAULT_POLICY;

	try {
		return parsePolicy(JSON.parse(readFileSync(configPath, "utf8")));
	} catch {
		return DEFAULT_POLICY;
	}
}

export function resolveEffectivePolicy(
	policy: CompactionTriggerPolicy,
	model: ExtensionContext["model"],
): CompactionTriggerPolicy {
	if (!model || !policy.profiles) return policy;
	const selector = `${model.provider}/${model.id}`;
	for (const profileName of Object.keys(policy.profiles).sort()) {
		const profile = policy.profiles[profileName];
		if (profile.match !== selector) continue;
		return {
			...policy,
			trigger: { ...policy.trigger, ...(profile.trigger ?? {}) },
			ui: { ...policy.ui, ...(profile.ui ?? {}) },
		};
	}
	return policy;
}

export function shouldTriggerProactiveCompact(input: {
	lastAssistantMessage: AssistantMessage | undefined;
	usage: Pick<ContextUsage, "tokens" | "percent" | "contextWindow"> | undefined;
	inFlight: boolean;
	nowMs: number;
	lastProactiveAtMs: number | undefined;
	policy: CompactionTriggerPolicy;
}): boolean {
	const { lastAssistantMessage, usage, inFlight, nowMs, lastProactiveAtMs, policy } = input;
	if (!policy.enabled) return false;
	if (!lastAssistantMessage) return false;
	if (lastAssistantMessage.stopReason === "error" || lastAssistantMessage.stopReason === "aborted") return false;
	if (!usage) return false;
	if (usage.tokens == null || usage.percent == null) return false;
	if (inFlight) return false;
	if (typeof lastProactiveAtMs === "number" && nowMs - lastProactiveAtMs < policy.trigger.cooldownMs) return false;
	const { maxTokens } = policy.trigger;
	if (maxTokens === undefined || maxTokens <= 0) return false;
	if (usage.tokens < policy.trigger.minTokens) return false;
	if (usage.tokens < maxTokens) return false;

	const builtinPercentRaw = usage.contextWindow > 0
		? 100 * (1 - policy.trigger.builtinReserveTokens / usage.contextWindow)
		: 100;
	const builtinPercent = Math.max(0, Math.min(100, builtinPercentRaw));
	if (usage.percent >= builtinPercent - policy.trigger.builtinSkipMarginPercent) return false;
	return true;
}

function formatTokenCount(value: number): string {
	if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
	return `${value}`;
}

export function formatStatus(
	policy: CompactionTriggerPolicy,
	usage: Pick<ContextUsage, "tokens" | "contextWindow">,
): string | undefined {
	if (!policy.enabled || !policy.ui.showStatus) return undefined;
	const limit = policy.trigger.maxTokens && policy.trigger.maxTokens > 0
		? policy.trigger.maxTokens
		: usage.contextWindow;
	if (!limit || limit <= 0) return policy.ui.name;
	const pct = (usage.tokens / limit) * 100;
	return `${policy.ui.name} · ${pct.toFixed(1)}% (${formatTokenCount(usage.tokens)}/${formatTokenCount(limit)})`;
}

function getLastAssistantMessage(messages: unknown): AssistantMessage | undefined {
	if (!Array.isArray(messages)) return undefined;
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index] as { role?: unknown } | undefined;
		if (message?.role === "assistant") return message as AssistantMessage;
	}
	return undefined;
}

export default function lcmCompactionTriggerExtension(pi: ExtensionAPI) {
	let inFlight = false;
	let lastProactiveAtMs: number | undefined;
	let warnedSummaryRetention = false;

	const maybeWarnSummaryRetention = (ctx: ExtensionContext, policy: CompactionTriggerPolicy) => {
		if (warnedSummaryRetention || !policy.enabled || !policy.summaryRetention) return;
		warnedSummaryRetention = true;
		ctx.ui.notify(
			"LCM trigger bridge: compaction-policy.json summaryRetention is currently ignored. LCM decides retained raw context separately.",
			"warning",
		);
	};

	const updateStatus = (ctx: ExtensionContext) => {
		const policy = resolveEffectivePolicy(loadCompactionTriggerPolicy(ctx.cwd), ctx.model);
		maybeWarnSummaryRetention(ctx, policy);
		ctx.ui.setStatus(STATUS_KEY, formatStatus(policy, ctx.getContextUsage()));
	};

	const clearState = (ctx: ExtensionContext) => {
		inFlight = false;
		lastProactiveAtMs = undefined;
		warnedSummaryRetention = false;
		ctx.ui.setStatus(STATUS_KEY, undefined);
	};

	pi.on("agent_end", async (event, ctx) => {
		const policy = resolveEffectivePolicy(loadCompactionTriggerPolicy(ctx.cwd), ctx.model);
		if (!policy.enabled) {
			clearState(ctx);
			return;
		}

		updateStatus(ctx);
		const shouldTrigger = shouldTriggerProactiveCompact({
			lastAssistantMessage: getLastAssistantMessage((event as { messages?: unknown[] }).messages),
			usage: ctx.getContextUsage(),
			inFlight,
			nowMs: Date.now(),
			lastProactiveAtMs,
			policy,
		});
		if (!shouldTrigger) return;

		inFlight = true;
		lastProactiveAtMs = Date.now();
		ctx.compact({
			onComplete: () => {
				inFlight = false;
				updateStatus(ctx);
			},
			onError: (error) => {
				inFlight = false;
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`LCM proactive compaction failed: ${message}`, "error");
				updateStatus(ctx);
			},
		});
	});

	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("session_tree", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("session_compact", async (_event, ctx) => {
		inFlight = false;
		updateStatus(ctx);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		clearState(ctx);
	});
}
