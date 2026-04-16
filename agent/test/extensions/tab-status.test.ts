import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import tabStatusExtension, {
	buildSessionSummaryInput,
	extractConversationPairs,
	getSummaryThresholdToEvaluate,
	parseStructuredSessionLabel,
} from "../../extensions/tab-status.js";

const userMessage = (text: string): AgentMessage => ({
	role: "user",
	content: text,
	timestamp: 0,
}) as AgentMessage;

const assistantMessage = (text: string): AgentMessage => ({
	role: "assistant",
	content: [{ type: "text", text }],
	timestamp: 0,
}) as AgentMessage;

type RegisteredCommand = {
	handler: (args: string, ctx: ExtensionContext) => Promise<void>;
};

const createExtensionHarness = (): {
	handlers: Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>;
	command: RegisteredCommand | undefined;
} => {
	const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
	let command: RegisteredCommand | undefined;
	const pi = {
		on: vi.fn((event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => {
			handlers.set(event, handler);
		}),
		registerCommand: vi.fn((name: string, config: RegisteredCommand) => {
			if (name === "rename-tab") {
				command = config;
			}
		}),
	} as unknown as ExtensionAPI;
	 tabStatusExtension(pi);
	return { handlers, command };
};

const createContext = (options?: { sessionName?: string; branch?: AgentMessage[] }): ExtensionContext => {
	const branchMessages = options?.branch ?? [];
	return {
		hasUI: true,
		cwd: "/tmp/pi-agent",
		ui: {
			setTitle: vi.fn(),
			notify: vi.fn(),
		} as unknown as ExtensionContext["ui"],
		sessionManager: {
			getSessionName: () => options?.sessionName,
			getBranch: () => branchMessages.map((message) => ({ type: "message", message })),
		} as unknown as ExtensionContext["sessionManager"],
		modelRegistry: {
			find: vi.fn(),
			getAvailable: vi.fn(() => []),
		} as unknown as ExtensionContext["modelRegistry"],
		model: undefined,
		isIdle: () => true,
		signal: undefined,
		abort: vi.fn(),
		hasPendingMessages: () => false,
		shutdown: vi.fn(),
		getContextUsage: () => undefined,
		compact: vi.fn(),
		getSystemPrompt: () => "",
	} as ExtensionContext;
};

afterEach(() => {
	vi.useRealTimers();
});

describe("tab status command", () => {
	it("registers /rename-tab", () => {
		const { command } = createExtensionHarness();
		expect(command).toBeDefined();
	});

	it("shows usage when no label is provided", async () => {
		const { command } = createExtensionHarness();
		const ctx = createContext();

		await command!.handler("   ", ctx);

		expect(ctx.ui.notify).toHaveBeenCalledWith("Usage: /rename-tab <new tab label>", "error");
	});

	it("keeps a manual tab label through prompt refreshes until auto rename runs", async () => {
		vi.useFakeTimers();
		const { command, handlers } = createExtensionHarness();
		const ctx = createContext();

		await handlers.get("session_start")!({ type: "session_start", reason: "new" }, ctx);
		vi.mocked(ctx.ui.setTitle).mockClear();

		await command!.handler("Focus label", ctx);
		expect(ctx.ui.setTitle).toHaveBeenLastCalledWith("Focus label: 🆕");

		vi.mocked(ctx.ui.setTitle).mockClear();
		await handlers.get("before_agent_start")!({ type: "before_agent_start", prompt: "Switch to some other fallback label" }, ctx);
		await handlers.get("session_shutdown")!({ type: "session_shutdown" }, ctx);

		expect(ctx.ui.setTitle).toHaveBeenCalledWith("Focus label");
	});
});

describe("tab status session pair extraction", () => {
	it("treats consecutive user messages as one exchange pair", () => {
		const pairs = extractConversationPairs([
			userMessage("Need the tab label to summarize the session."),
			userMessage("Use the first and latest exchanges."),
			assistantMessage("I can do that with a compact session summary."),
		]);

		expect(pairs).toEqual([
			{
				user: "Need the tab label to summarize the session.\nUse the first and latest exchanges.",
				assistant: "I can do that with a compact session summary.",
			},
		]);
	});
});

describe("tab status summary input", () => {
	it("uses the first two and last two exchange pairs", () => {
		const messages: AgentMessage[] = [
			userMessage("pair one user"),
			assistantMessage("pair one assistant"),
			userMessage("pair two user"),
			assistantMessage("pair two assistant"),
			userMessage("pair three user"),
			assistantMessage("pair three assistant"),
			userMessage("pair four user"),
			assistantMessage("pair four assistant"),
			userMessage("pair five user"),
			assistantMessage("pair five assistant"),
		];

		const input = buildSessionSummaryInput(messages);

		expect(input).toContain("Opening session pairs");
		expect(input).toContain("pair one user");
		expect(input).toContain("pair two assistant");
		expect(input).toContain("Recent session pairs");
		expect(input).toContain("pair four user");
		expect(input).toContain("pair five assistant");
		expect(input).not.toContain("pair three user");
		expect(input).not.toContain("pair three assistant");
	});
});

describe("tab status summary cadence", () => {
	it("only evaluates on a new four-pair boundary", () => {
		expect(getSummaryThresholdToEvaluate(3, 0)).toBeNull();
		expect(getSummaryThresholdToEvaluate(4, 0)).toBe(4);
		expect(getSummaryThresholdToEvaluate(7, 4)).toBeNull();
		expect(getSummaryThresholdToEvaluate(8, 4)).toBe(8);
	});
});

describe("tab status structured label parsing", () => {
	it("parses JSON output and enforces a four-word cap", () => {
		const label = parseStructuredSessionLabel('{"label":"  Fix tab status summarizer today!!  "}');

		expect(label).toBe("Fix tab status summarizer");
	});

	it("rejects non-JSON output", () => {
		expect(parseStructuredSessionLabel("Fix tab status summarizer")).toBe("");
	});
});
