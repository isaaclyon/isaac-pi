import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssistantMessage } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import lcmCompactionTriggerExtension, {
	DEFAULT_POLICY,
	formatStatus,
	resolveEffectivePolicy,
	shouldTriggerProactiveCompact,
} from "../../extensions/lcm-compaction-trigger.js";

type RegisteredHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

const tempDirs: string[] = [];

function createProjectPolicyDir(policy: unknown): string {
	const root = mkdtempSync(join(tmpdir(), "lcm-trigger-"));
	tempDirs.push(root);
	mkdirSync(join(root, ".pi"), { recursive: true });
	writeFileSync(join(root, ".pi", "compaction-policy.json"), JSON.stringify(policy));
	return root;
}

afterEach(() => {
	vi.restoreAllMocks();
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function assistantMessage(stopReason: "stop" | "error" | "aborted" = "stop"): AssistantMessage {
	return {
		role: "assistant",
		content: [{ type: "text", text: "done" }],
		timestamp: 0,
		stopReason,
		usage: { input: 10, output: 10, cacheRead: 0, cacheWrite: 0, totalTokens: 20 },
	} as AssistantMessage;
}

function createHarness(): {
	handlers: Map<string, RegisteredHandler>;
} {
	const handlers = new Map<string, RegisteredHandler>();
	const pi = {
		on: vi.fn((event: string, handler: RegisteredHandler) => {
			handlers.set(event, handler);
		}),
	} as unknown as ExtensionAPI;

	lcmCompactionTriggerExtension(pi);
	return { handlers };
}

function createContext(overrides?: {
	cwd?: string;
	model?: ExtensionContext["model"];
	usage?: ReturnType<ExtensionContext["getContextUsage"]>;
}): ExtensionContext {
	return {
		hasUI: true,
		cwd: overrides?.cwd ?? "/tmp/project",
		model: overrides?.model,
		ui: {
			setStatus: vi.fn(),
			notify: vi.fn(),
		},
		getContextUsage: () => overrides?.usage ?? ({ tokens: 120_000, percent: 12, contextWindow: 1_000_000 } as ReturnType<ExtensionContext["getContextUsage"]>),
		compact: vi.fn(),
	} as unknown as ExtensionContext;
}

describe("shouldTriggerProactiveCompact", () => {
	it("triggers when usage crosses the configured max token threshold", () => {
		const result = shouldTriggerProactiveCompact({
			lastAssistantMessage: assistantMessage(),
			usage: { tokens: 120_000, percent: 12, contextWindow: 1_000_000 },
			inFlight: false,
			nowMs: 200_000,
			lastProactiveAtMs: undefined,
			policy: {
				...DEFAULT_POLICY,
				enabled: true,
				trigger: { ...DEFAULT_POLICY.trigger, maxTokens: 100_000 },
			},
		});

		expect(result).toBe(true);
	});

	it("does not trigger when builtin compaction is already about to fire", () => {
		const result = shouldTriggerProactiveCompact({
			lastAssistantMessage: assistantMessage(),
			usage: { tokens: 980_000, percent: 98.5, contextWindow: 1_000_000 },
			inFlight: false,
			nowMs: 200_000,
			lastProactiveAtMs: undefined,
			policy: {
				...DEFAULT_POLICY,
				enabled: true,
				trigger: { ...DEFAULT_POLICY.trigger, maxTokens: 100_000 },
			},
		});

		expect(result).toBe(false);
	});
});

describe("resolveEffectivePolicy", () => {
	it("applies matching profile trigger overrides for the active model", () => {
		const policy = resolveEffectivePolicy(
			{
				...DEFAULT_POLICY,
				enabled: true,
				trigger: { ...DEFAULT_POLICY.trigger, maxTokens: 100_000 },
				profiles: {
					fast: {
						match: "openai-codex/gpt-5.4",
						trigger: { maxTokens: 75_000 },
					},
				},
			},
			{ provider: "openai-codex", id: "gpt-5.4" },
		);

		expect(policy.trigger.maxTokens).toBe(75_000);
	});
});

describe("formatStatus", () => {
	it("renders progress against the proactive compaction limit", () => {
		const status = formatStatus(
			{
				...DEFAULT_POLICY,
				enabled: true,
				ui: { ...DEFAULT_POLICY.ui, name: "ctx" },
				trigger: { ...DEFAULT_POLICY.trigger, maxTokens: 100_000 },
			},
			{ tokens: 25_000, contextWindow: 1_000_000 },
		);

		expect(status).toBe("ctx · 25.0% (25k/100k)");
	});
});

describe("lcm compaction trigger extension", () => {
	it("triggers ctx.compact on agent_end without registering its own compaction override", async () => {
		const { handlers } = createHarness();
		const ctx = createContext({
			cwd: createProjectPolicyDir({ enabled: true, trigger: { maxTokens: 100000 } }),
		});

		vi.spyOn(Date, "now").mockReturnValue(200_000);

		await handlers.get("agent_end")!(
			{ messages: [assistantMessage()] },
			ctx,
		);

		expect(handlers.has("session_before_compact")).toBe(false);
		expect(ctx.compact).toHaveBeenCalledTimes(1);
	});

	it("uses project compaction-policy.json to proactively compact", async () => {
		const { handlers } = createHarness();
		const ctx = createContext({
			cwd: createProjectPolicyDir({ enabled: true, trigger: { maxTokens: 100000 } }),
		});

		vi.spyOn(Date, "now").mockReturnValue(200_000);

		await handlers.get("agent_end")!(
			{ messages: [assistantMessage()] },
			ctx,
		);

		expect(ctx.compact).toHaveBeenCalledTimes(1);
	});

	it("warns once per session when summaryRetention is configured but not applied", async () => {
		const { handlers } = createHarness();
		const ctx = createContext({
			cwd: createProjectPolicyDir({
				enabled: true,
				trigger: { maxTokens: 100000 },
				summaryRetention: { mode: "percent", value: 30 },
			}),
		});

		await handlers.get("session_start")!({ type: "session_start", reason: "new" }, ctx);
		await handlers.get("session_start")!({ type: "session_start", reason: "resume" }, ctx);

		expect(ctx.ui.notify).toHaveBeenCalledTimes(1);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			expect.stringContaining("summaryRetention is currently ignored"),
			"warning",
		);
	});
});
