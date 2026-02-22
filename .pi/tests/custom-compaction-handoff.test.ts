import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

vi.mock("@mariozechner/pi-ai", () => ({
	complete: vi.fn(),
}));

import { complete } from "@mariozechner/pi-ai";

import customCompactionHandoffExtension from "../extensions/custom-compaction-handoff.js";
import { HANDOFF_SYSTEM_PROMPT } from "../extensions/_shared/handoff.js";

type TestContext = {
	hasUI: boolean;
	ui: {
		notify: ReturnType<typeof vi.fn>;
	};
	model: { provider: string; id: string } | undefined;
	modelRegistry: {
		getApiKey: ReturnType<typeof vi.fn>;
	};
};

type ContextOptions = {
	hasUI?: boolean;
	apiKey?: string | null;
	model?: { provider: string; id: string } | undefined;
};

const BASE_PREPARATION = {
	firstKeptEntryId: "entry-123",
	messagesToSummarize: [{ role: "user", content: "Initial task", timestamp: Date.now() }],
	turnPrefixMessages: [{ role: "user", content: "Refine approach", timestamp: Date.now() }],
	isSplitTurn: true,
	tokensBefore: 4200,
	previousSummary: "Previous checkpoint",
	fileOps: {
		read: new Set(["src/one.ts"]),
		written: new Set(["src/two.ts"]),
		edited: new Set(["src/three.ts"]),
	},
	settings: {
		enabled: true,
		reserveTokens: 2000,
		keepRecentTokens: 20000,
	},
};

describe("custom-compaction-handoff extension", () => {
	let handlers: Record<string, Array<(event: any, ctx: TestContext) => unknown>>;

	beforeEach(() => {
		handlers = {};
		const pi = {
			on: vi.fn((event, handler) => {
				if (!handlers[event]) handlers[event] = [];
				handlers[event]!.push(handler as (event: any, ctx: TestContext) => unknown);
			}),
		} as unknown as ExtensionAPI;

		vi.mocked(complete).mockReset().mockResolvedValue({
			role: "assistant",
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-sonnet-4-5",
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			},
			stopReason: "stop",
			content: [{ type: "text", text: "handoff summary" }],
			timestamp: Date.now(),
		});

		customCompactionHandoffExtension(pi);
	});

	function createContext(options: ContextOptions = {}): TestContext {
		const hasUI = options.hasUI ?? true;
		const apiKey = "apiKey" in options ? options.apiKey : "test-key";
		const model = "model" in options ? options.model : { provider: "anthropic", id: "claude-sonnet-4-5" };
		return {
			hasUI,
			ui: {
				notify: vi.fn(),
			},
			model,
			modelRegistry: {
				getApiKey: vi.fn().mockResolvedValue(apiKey),
			},
		};
	}

	it("calls complete() with handoff-style prompt and returns compaction shape", async () => {
		const handler = handlers.session_before_compact?.[0];
		if (!handler) throw new Error("session_before_compact handler missing");

		const event = {
			preparation: BASE_PREPARATION,
			branchEntries: [],
			customInstructions: "Focus on open risks",
			signal: new AbortController().signal,
		};
		const ctx = createContext();

		const result = await handler(event, ctx) as { compaction?: any };

		expect(complete).toHaveBeenCalledOnce();
		const [modelArg, completionContext, optionsArg] = vi.mocked(complete).mock.calls[0]!;
		expect(modelArg).toEqual(ctx.model);
		expect(completionContext.systemPrompt).toBe(HANDOFF_SYSTEM_PROMPT);
		expect(optionsArg).toMatchObject({ apiKey: "test-key", signal: event.signal, maxTokens: 1600 });

		const promptText = (completionContext.messages[0] as any).content[0].text as string;
		expect(promptText).toContain("## Context");
		expect(promptText).toContain("### What was decided");
		expect(promptText).toContain("### What was done");
		expect(promptText).toContain("### Blockers");
		expect(promptText).toContain("### Key files touched");
		expect(promptText).toContain("### Current state");
		expect(promptText).toContain("### Next concrete step(s)");
		expect(promptText).toContain("Focus on open risks");

		expect(result.compaction).toMatchObject({
			summary: "handoff summary",
			firstKeptEntryId: "entry-123",
			tokensBefore: 4200,
			details: {
				readFiles: ["src/one.ts"],
				modifiedFiles: ["src/three.ts", "src/two.ts"],
			},
		});
	});

	it("falls back when model or api key is missing", async () => {
		const handler = handlers.session_before_compact?.[0];
		if (!handler) throw new Error("session_before_compact handler missing");

		const baseEvent = {
			preparation: BASE_PREPARATION,
			branchEntries: [],
			customInstructions: undefined,
			signal: new AbortController().signal,
		};

		const noModelResult = await handler(baseEvent, createContext({ model: undefined }));
		expect(noModelResult).toBeUndefined();

		const noKeyResult = await handler(baseEvent, createContext({ apiKey: null }));
		expect(noKeyResult).toBeUndefined();
		expect(complete).not.toHaveBeenCalled();
	});

	it("returns undefined when complete() fails instead of throwing", async () => {
		const handler = handlers.session_before_compact?.[0];
		if (!handler) throw new Error("session_before_compact handler missing");

		const ctx = createContext();
		const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
		vi.mocked(complete).mockRejectedValueOnce(new Error("boom"));

		const result = await handler(
			{
				preparation: BASE_PREPARATION,
				branchEntries: [],
				customInstructions: undefined,
				signal: new AbortController().signal,
			},
			ctx,
		);

		consoleSpy.mockRestore();
		expect(result).toBeUndefined();
		expect(ctx.ui.notify).toHaveBeenCalledWith("Global handoff compaction failed: boom", "warning");
	});
});
