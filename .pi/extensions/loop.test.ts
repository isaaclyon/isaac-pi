import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

vi.mock("@mariozechner/pi-ai", () => ({
	complete: vi.fn(),
}));

vi.mock("@mariozechner/pi-coding-agent", () => ({
	compact: vi.fn(),
	DynamicBorder: class DynamicBorder {
		constructor(_render: (text: string) => string) {
			// noop for tests
		}
	},
}));

vi.mock("@mariozechner/pi-tui", () => ({
	Container: class Container {
		addChild(_child: unknown): void {
			// noop for tests
		}
		render(_width: number): string[] {
			return [];
		}
		invalidate(): void {
			// noop for tests
		}
	},
	SelectList: class SelectList {
		onSelect?: (item: { value: string }) => void;
		onCancel?: () => void;
		constructor(_items: unknown[], _maxVisible: number, _theme: unknown) {
			// noop for tests
		}
		handleInput(_data: string): void {
			// noop for tests
		}
	},
	Text: class Text {
		constructor(_text: string) {
			// noop for tests
		}
	},
}));

import { complete } from "@mariozechner/pi-ai";
import { compact } from "@mariozechner/pi-coding-agent";
import loopExtension from "./loop.js";

type RegisteredCommand = {
	handler: (args: string, ctx: TestContext) => Promise<void>;
};

type RegisteredTool = {
	execute: (
		_toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: unknown,
		ctx: TestContext,
	) => Promise<{ content: Array<{ type: string; text: string }>; details: { active: boolean } }>;
};

type TestContext = {
	hasUI: boolean;
	ui: {
		notify: ReturnType<typeof vi.fn>;
		confirm: ReturnType<typeof vi.fn>;
		setWidget: ReturnType<typeof vi.fn>;
		editor: ReturnType<typeof vi.fn>;
		custom: ReturnType<typeof vi.fn>;
		theme: {
			fg: (color: string, text: string) => string;
			bold: (text: string) => string;
		};
	};
	hasPendingMessages: ReturnType<typeof vi.fn>;
	getContextUsage: ReturnType<typeof vi.fn>;
	compact: ReturnType<typeof vi.fn>;
	model: { provider: string; id: string } | undefined;
	modelRegistry: {
		find: ReturnType<typeof vi.fn>;
		getApiKey: ReturnType<typeof vi.fn>;
	};
	sessionManager: {
		getEntries: ReturnType<typeof vi.fn>;
	};
};

type ContextOptions = {
	percent?: number;
	hasUI?: boolean;
	entries?: unknown[];
	apiKey?: string | null;
	model?: { provider: string; id: string } | undefined;
};

const flushMicrotasks = async (): Promise<void> => {
	await Promise.resolve();
	await Promise.resolve();
};

describe("loop extension", () => {
	let commands: Record<string, RegisteredCommand>;
	let tools: Record<string, RegisteredTool>;
	let handlers: Record<string, Array<(event: any, ctx: TestContext) => unknown>>;
	let sendMessage: ReturnType<typeof vi.fn>;
	let appendEntry: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		commands = {};
		tools = {};
		handlers = {};
		sendMessage = vi.fn();
		appendEntry = vi.fn();

		const pi = {
			registerTool: vi.fn((config) => {
				tools[config.name] = config as RegisteredTool;
			}),
			registerCommand: vi.fn((name, config) => {
				commands[name] = config as RegisteredCommand;
			}),
			on: vi.fn((event, handler) => {
				if (!handlers[event]) handlers[event] = [];
				handlers[event]!.push(handler as (event: any, ctx: TestContext) => unknown);
			}),
			sendMessage,
			appendEntry,
		} as unknown as ExtensionAPI;

		vi.mocked(complete).mockReset().mockResolvedValue({
			role: "assistant",
			api: "anthropic-messages",
			provider: "anthropic",
			model: "claude-haiku-4-5",
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
			content: [{ type: "text", text: "loops until tests pass" }],
			timestamp: Date.now(),
		});
		vi.mocked(compact).mockReset().mockResolvedValue({
			summary: "summary",
			firstKeptEntryId: "entry-1",
			tokensBefore: 1200,
		});

		loopExtension(pi);
	});

	function createContext(options: ContextOptions = {}): TestContext {
		const {
			percent = 10,
			hasUI = true,
			entries = [],
			apiKey = "test-key",
			model = { provider: "anthropic", id: "claude-sonnet-4-5" },
		} = options;

		return {
			hasUI,
			ui: {
				notify: vi.fn(),
				confirm: vi.fn().mockResolvedValue(true),
				setWidget: vi.fn(),
				editor: vi.fn(),
				custom: vi.fn(),
				theme: {
					fg: (_color: string, text: string) => text,
					bold: (text: string) => text,
				},
			},
			hasPendingMessages: vi.fn().mockReturnValue(false),
			getContextUsage: vi.fn().mockImplementation(() => ({ percent })),
			compact: vi.fn(),
			model,
			modelRegistry: {
				find: vi.fn().mockReturnValue({ provider: "anthropic", id: "claude-haiku-4-5" }),
				getApiKey: vi.fn().mockResolvedValue(apiKey),
			},
			sessionManager: {
				getEntries: vi.fn().mockReturnValue(entries),
			},
		};
	}

	it("compacts on agent_end at or above 50% usage", async () => {
		const ctx = createContext({ percent: 50 });
		await commands.loop!.handler("tests", ctx);

		const agentEnd = handlers.agent_end?.[0];
		if (!agentEnd) throw new Error("agent_end handler missing");

		await agentEnd({ messages: [{ role: "assistant", stopReason: "done" }] }, ctx);

		expect(ctx.compact).toHaveBeenCalledOnce();
		expect(sendMessage).toHaveBeenCalledTimes(1);
		const widgetDuringCompaction = ctx.ui.setWidget.mock.calls.at(-1)?.[1] as string[] | undefined;
		expect(widgetDuringCompaction?.[0]).toContain("[compacting...]");
		expect(ctx.ui.notify).toHaveBeenCalledWith("Loop compaction triggered at 50.0% context", "info");
		expect(appendEntry).toHaveBeenCalledWith(
			"loop-compaction",
			expect.objectContaining({ phase: "triggered", percent: 50, threshold: 50 }),
		);

		const callbacks = ctx.compact.mock.calls[0]?.[0] as { onComplete: () => void; onError: () => void };
		expect(typeof callbacks.onComplete).toBe("function");
		expect(typeof callbacks.onError).toBe("function");

		callbacks.onComplete();
		expect(sendMessage).toHaveBeenCalledTimes(2);
		const widgetAfterCompaction = ctx.ui.setWidget.mock.calls.at(-1)?.[1] as string[] | undefined;
		expect(widgetAfterCompaction?.[0]).not.toContain("[compacting...]");
		expect(ctx.ui.notify).toHaveBeenCalledWith("Loop compaction complete. Continuing loop.", "info");
		expect(appendEntry).toHaveBeenCalledWith(
			"loop-compaction",
			expect.objectContaining({ phase: "completed", percent: 50, threshold: 50 }),
		);
	});

	it("continues loop without compaction below 50% usage", async () => {
		const ctx = createContext({ percent: 49 });
		await commands.loop!.handler("tests", ctx);

		const agentEnd = handlers.agent_end?.[0];
		if (!agentEnd) throw new Error("agent_end handler missing");
		await agentEnd({ messages: [{ role: "assistant", stopReason: "done" }] }, ctx);

		expect(ctx.compact).not.toHaveBeenCalled();
		expect(sendMessage).toHaveBeenCalledTimes(2);
	});

	it("shows breadcrumb when loop compaction errors", async () => {
		const ctx = createContext({ percent: 60 });
		await commands.loop!.handler("tests", ctx);

		const agentEnd = handlers.agent_end?.[0];
		if (!agentEnd) throw new Error("agent_end handler missing");
		await agentEnd({ messages: [{ role: "assistant", stopReason: "done" }] }, ctx);

		const callbacks = ctx.compact.mock.calls[0]?.[0] as { onComplete: () => void; onError: () => void };
		callbacks.onError();

		const widgetAfterError = ctx.ui.setWidget.mock.calls.at(-1)?.[1] as string[] | undefined;
		expect(widgetAfterError?.[0]).not.toContain("[compacting...]");
		expect(ctx.ui.notify).toHaveBeenCalledWith("Loop compaction failed. Continuing loop.", "warning");
		expect(appendEntry).toHaveBeenCalledWith(
			"loop-compaction",
			expect.objectContaining({ phase: "failed", percent: 60, threshold: 50 }),
		);
	});

	it("breaks loop when the last assistant turn was aborted and user confirms", async () => {
		const ctx = createContext({ percent: 80 });
		await commands.loop!.handler("tests", ctx);

		const agentEnd = handlers.agent_end?.[0];
		if (!agentEnd) throw new Error("agent_end handler missing");

		await agentEnd({ messages: [{ role: "assistant", stopReason: "aborted" }] }, ctx);

		expect(ctx.ui.confirm).toHaveBeenCalledOnce();
		expect(ctx.ui.notify).toHaveBeenCalledWith("Loop ended", "info");
		expect(ctx.compact).not.toHaveBeenCalled();
	});

	it("appends wrap-up warning once per loop turn when context is high", async () => {
		const ctx = createContext({ percent: 55 });
		await commands.loop!.handler("tests", ctx);

		const toolResult = handlers.tool_result?.[0];
		if (!toolResult) throw new Error("tool_result handler missing");

		const first = await toolResult({ content: [{ type: "text", text: "base" }] }, ctx) as {
			content: Array<{ type: string; text: string }>;
		};
		expect(first.content.at(-1)?.text).toContain("CONTEXT LIMIT WARNING");

		const second = await toolResult({ content: [{ type: "text", text: "base" }] }, ctx);
		expect(second).toBeUndefined();

		const agentEnd = handlers.agent_end?.[0];
		if (!agentEnd) throw new Error("agent_end handler missing");
		ctx.getContextUsage.mockReturnValue({ percent: 40 });
		await agentEnd({ messages: [{ role: "assistant", stopReason: "done" }] }, ctx);

		ctx.getContextUsage.mockReturnValue({ percent: 55 });
		const third = await toolResult({ content: [{ type: "text", text: "base" }] }, ctx) as {
			content: Array<{ type: string; text: string }>;
		};
		expect(third.content.at(-1)?.text).toContain("CONTEXT LIMIT WARNING");
	});

	it("signal_loop_success clears active loops", async () => {
		const ctx = createContext();
		const tool = tools.signal_loop_success;
		if (!tool) throw new Error("signal_loop_success tool missing");

		const inactive = await tool.execute("id", {}, undefined, undefined, ctx);
		expect(inactive.content[0]?.text).toContain("No active loop");

		await commands.loop!.handler("self", ctx);
		const active = await tool.execute("id", {}, undefined, undefined, ctx);
		expect(active.content[0]?.text).toBe("Loop ended.");
		expect(appendEntry).toHaveBeenLastCalledWith("loop-state", { active: false });
	});

	it("shows usage when /loop has no args in non-UI mode", async () => {
		const ctx = createContext({ hasUI: false });
		await commands.loop!.handler("", ctx);
		expect(ctx.ui.notify).toHaveBeenCalledWith(
			"Usage: /loop tests | /loop custom <condition> | /loop self",
			"warning",
		);
	});

	it("supports interactive selector and cancellation when args are omitted", async () => {
		const startCtx = createContext();
		startCtx.ui.custom.mockResolvedValue("tests");
		await commands.loop!.handler("", startCtx);
		expect(startCtx.ui.notify).toHaveBeenCalledWith("Loop active", "info");

		const cancelCtx = createContext();
		cancelCtx.ui.custom.mockResolvedValue(null);
		await commands.loop!.handler("", cancelCtx);
		expect(cancelCtx.ui.notify).toHaveBeenCalledWith("Loop cancelled", "info");
	});

	it("keeps current loop when replacement is rejected", async () => {
		const ctx = createContext();
		await commands.loop!.handler("tests", ctx);
		expect(sendMessage).toHaveBeenCalledTimes(1);

		ctx.ui.confirm.mockResolvedValue(false);
		await commands.loop!.handler("self", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Loop unchanged", "info");
		expect(sendMessage).toHaveBeenCalledTimes(1);
	});

	it("replaces loop without confirmation in non-UI mode", async () => {
		const ctx = createContext();
		await commands.loop!.handler("tests", ctx);
		expect(sendMessage).toHaveBeenCalledTimes(1);

		ctx.hasUI = false;
		await commands.loop!.handler("self", ctx);
		expect(sendMessage).toHaveBeenCalledTimes(2);
	});

	it("uses loop-aware custom instructions during session_before_compact", async () => {
		const ctx = createContext();
		await commands.loop!.handler("custom API health checks pass", ctx);

		const beforeCompact = handlers.session_before_compact?.[0];
		if (!beforeCompact) throw new Error("session_before_compact handler missing");

		const result = await beforeCompact(
			{ preparation: { messagesToSummarize: [] }, customInstructions: "keep decisions", signal: undefined },
			ctx,
		) as { compaction?: unknown };

		expect(compact).toHaveBeenCalledOnce();
		const instructionArg = vi.mocked(compact).mock.calls[0]?.[3];
		expect(instructionArg).toContain("keep decisions");
		expect(instructionArg).toContain("automated loop working toward: API health checks pass");
		expect(result.compaction).toBeTruthy();
	});

	it("handles compaction errors in session_before_compact", async () => {
		const ctx = createContext();
		await commands.loop!.handler("tests", ctx);
		vi.mocked(compact).mockRejectedValueOnce(new Error("boom"));

		const beforeCompact = handlers.session_before_compact?.[0];
		if (!beforeCompact) throw new Error("session_before_compact handler missing");

		const result = await beforeCompact(
			{ preparation: { messagesToSummarize: [] }, customInstructions: "", signal: undefined },
			ctx,
		);
		expect(result).toBeUndefined();
		expect(ctx.ui.notify).toHaveBeenCalledWith("Loop compaction failed: boom", "warning");
	});

	it("restores loop state from session entries on session_start", async () => {
		const ctx = createContext({
			entries: [
				{ type: "custom", customType: "other", data: { active: false } },
				{ type: "custom", customType: "loop-state", data: { active: true, mode: "tests", prompt: "p", loopCount: 3 } },
			],
		});

		const sessionStart = handlers.session_start?.[0];
		if (!sessionStart) throw new Error("session_start handler missing");
		await sessionStart({}, ctx);
		await flushMicrotasks();

		expect(ctx.ui.setWidget).toHaveBeenCalled();
		expect(appendEntry).toHaveBeenCalledWith(
			"loop-state",
			expect.objectContaining({ active: true, mode: "tests", summary: "loops until tests pass" }),
		);
	});

	it("restores loop state on session_switch", async () => {
		const ctx = createContext({
			entries: [{ type: "custom", customType: "loop-state", data: { active: true, mode: "self", prompt: "p", loopCount: 1 } }],
		});
		const sessionSwitch = handlers.session_switch?.[0];
		if (!sessionSwitch) throw new Error("session_switch handler missing");
		await sessionSwitch({}, ctx);
		await flushMicrotasks();

		expect(ctx.ui.setWidget).toHaveBeenCalled();
	});
});
