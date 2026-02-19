import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
	AgentToolUpdateCallback,
	ExtensionContext,
	ExtensionAPI,
} from "@mariozechner/pi-coding-agent";

vi.mock("./execute.js", () => ({
	executeSingle: vi.fn(),
	executeChain: vi.fn(),
	executeParallel: vi.fn(),
}));

vi.mock("./skills.js", async () => {
	const actual = await vi.importActual<typeof import("./skills.js")>("./skills.js");
	return {
		...actual,
		loadSkillDiscovery: () => ({
			skills: [{ name: "skill-a", source: "local", filePath: "a", baseDir: "a" }],
			byName: new Map<string, { name: string }>([["skill-a", { name: "skill-a" }]]),
			baseCache: new Map<string, string>(),
		}),
		formatAvailableSkills: () => ({ text: "skill-a (local)", remaining: 0 }),
	};
});

import registerTaskTool from "./index.js";
import { executeChain, executeParallel, executeSingle } from "./execute.js";
import type { TaskToolDetails } from "./types.js";


type TaskParamsLike = { type: "single" | "chain" | "parallel"; tasks: { prompt: string }[] };

const taskModeParams = (
	mode: "single" | "chain" | "parallel",
): TaskParamsLike => ({
	type: mode,
	tasks: mode === "single" ? [{ prompt: "one" }] : [{ prompt: "one" }, { prompt: "two" }],
});

describe("task extension registration", () => {
	let tool: {
		execute: (
			_toolCallId: string,
			params: unknown,
			signal: AbortSignal | undefined,
			onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined,
			ctx: ExtensionContext,
		) => Promise<{ details: { mode: string; results: unknown[] } } & { content: unknown[] }>;
		renderCall: (args: Record<string, unknown>, theme: unknown) => unknown;
		renderResult: (result: unknown, options: unknown, theme: unknown) => unknown;
	} & Record<string, unknown>;
	let beforeHook: ((event: { systemPrompt: string }) => { systemPrompt: string }) | undefined;
	let pi: ExtensionAPI;

	beforeEach(() => {
		const registerTool = vi.fn((config) => {
			tool = config as any;
		});
		pi = {
			registerTool,
			getActiveTools: vi.fn(() => ["read", "bash", "custom"]),
			getThinkingLevel: vi.fn(() => "high"),
			on: vi.fn((_event, handler) => {
				beforeHook = handler as never;
			}),
		} as ExtensionAPI;

		vi.mocked(executeSingle).mockReset().mockResolvedValue({
			content: [{ type: "text", text: "single" }],
			details: { mode: "single", results: [] },
		});
		vi.mocked(executeChain).mockReset().mockResolvedValue({
			content: [{ type: "text", text: "chain" }],
			details: { mode: "chain", results: [] },
		});
		vi.mocked(executeParallel).mockReset().mockResolvedValue({
			content: [{ type: "text", text: "parallel" }],
			details: { mode: "parallel", results: [] },
		});

		registerTaskTool(pi);
	});

	it("forwards execution to executeSingle", async () => {
		if (!tool) throw new Error("tool not registered");
		const result = await tool.execute(
			"id",
			taskModeParams("single") as never,
			undefined,
			undefined,
			{
				cwd: "/repo",
				model: { provider: "openai", id: "gpt" },
			} as ExtensionContext,
		);
		expect(executeSingle).toHaveBeenCalledOnce();
		expect(result.content[0]?.text).toBe("single");
	});

	it("forwards execution to executeChain", async () => {
		if (!tool) throw new Error("tool not registered");
		await tool.execute(
			"id",
			taskModeParams("chain") as never,
			undefined,
			undefined,
			{
				cwd: "/repo",
				model: { provider: "openai", id: "gpt" },
			} as ExtensionContext,
		);
		expect(executeChain).toHaveBeenCalledOnce();
	});

	it("forwards execution to executeParallel", async () => {
		if (!tool) throw new Error("tool not registered");
		await tool.execute(
			"id",
			taskModeParams("parallel") as never,
			undefined,
			undefined,
			{
				cwd: "/repo",
				model: { provider: "openai", id: "gpt" },
			} as ExtensionContext,
		);
		expect(executeParallel).toHaveBeenCalledOnce();
	});

	it("appends system prompt in before_agent_start hook", async () => {
		if (!beforeHook) throw new Error("hook missing");
		const result = await beforeHook({ systemPrompt: "base" });
		expect(result.systemPrompt).toContain("Task tool — subprocess delegation");
		expect(result.systemPrompt.startsWith("base")).toBe(true);
	});

	it("returns validation error and skill list when params invalid", async () => {
		if (!tool) throw new Error("tool not registered");
		const result = await tool.execute(
			"id",
			{ type: "single", tasks: [] } as never,
			undefined,
			undefined,
			{
				cwd: "/repo",
				model: undefined,
			} as ExtensionContext,
		);
		expect(result.content[0]?.text).toContain("Available skills: skill-a (local)");
		expect(executeSingle).not.toHaveBeenCalled();
		expect(executeChain).not.toHaveBeenCalled();
		expect(executeParallel).not.toHaveBeenCalled();
	});

	it("passes through render helpers", () => {
		if (!tool) throw new Error("tool not registered");
		const call = { value: "x" } as Record<string, unknown>;
		const callTheme = { fg: (v: string, t: string) => `${v}:${t}` };
		expect(() => tool.renderCall(call, callTheme)).not.toThrow();
		expect(() => tool.renderResult({ content: [], details: { mode: "single", results: [] } }, {} as never, callTheme)).not.toThrow();
	});
});
