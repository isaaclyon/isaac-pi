import { describe, expect, it } from "vitest";

import {
	getFinalOutput,
	formatToolCounts,
	getTaskErrorText,
	isTaskError2,
	renderCall,
	renderResult,
} from "./render.js";
import type { SingleResult, TaskToolDetails } from "./types.js";
import type { AgentToolResult, Theme, ToolRenderResultOptions } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";

const theme = {
	fg: (tone: string, value: string) => `${tone}[${value}]`,
} as unknown as Theme;

const toText = (component: unknown): string[] => {
	if (typeof component === "string") return [component];
	if (component instanceof Text) {
		return component.render(120);
	}
	return (component as { text?: string })?.text?.split("\n") ?? [];
};

const baseResult = (overrides: Partial<SingleResult>): SingleResult => ({
	prompt: "prompt",
	exitCode: 0,
	messages: [],
	stderr: "",
	rawStdout: "",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		cost: 0,
		contextTokens: 0,
		turns: 0,
	},
	...overrides,
});

describe("render helpers", () => {
	it("detects task errors", () => {
		expect(isTaskError2(baseResult({ exitCode: 0 }))).toBe(false);
		expect(isTaskError2(baseResult({ exitCode: 1 }))).toBe(true);
		expect(isTaskError2(baseResult({ exitCode: 0, stopReason: "timeout" }))).toBe(true);
	});

	it("returns latest assistant text by selecting first assistant text in the last assistant message", () => {
		const output = getFinalOutput([
			{ role: "user", content: [{ type: "text", text: "u" }] } as never,
			{ role: "assistant", content: [{ type: "text", text: "first" }, { type: "text", text: "final" }] } as never,
			{ role: "assistant", content: [] as never } as never,
		]);
		expect(output).toBe("first");
	});

	it("formats tool counts in preference order", () => {
		const count = formatToolCounts([
			baseResult({
				messages: [{
					role: "assistant",
					content: [
						{ type: "toolCall", name: "write", arguments: {} },
						{ type: "toolCall", name: "bash", arguments: {} },
						{ type: "toolCall", name: "write", arguments: {} },
						{ type: "toolCall", name: "custom", arguments: {} },
					],
				}] as never,
			}),
		]);
		expect(count).toBe("bash(1) write(2) custom(1)");
	});

	it("returns failure text and includes verbose details when requested", () => {
		const failed = baseResult({
			exitCode: 9,
			errorMessage: "boom",
			failure: {
				command: "pi",
				args: ["--mode", "json"],
				cwd: "/repo",
				startedAt: "s",
				endedAt: "e",
				durationMs: 7,
				source: "unknown",
				exitCode: 9,
			},
		});

		delete process.env.PI_AGENT_VERBOSE;
		expect(getTaskErrorText(failed)).toBe("boom");

		process.env.PI_AGENT_VERBOSE = "yes";
		expect(getTaskErrorText(failed)).toMatch("Failure details:");
		expect(getTaskErrorText(failed)).toMatch("Command: pi --mode json");
	});
});

describe("renderCall", () => {
	it("formats single-task calls", () => {
		const comp = renderCall(
			{
				type: "single",
				tasks: [{ prompt: "do one thing", skill: undefined, name: "task1" }],
			} as unknown as Record<string, unknown>,
			theme,
		);
		expect(toText(comp).join("\n")).toContain("Task:");
	});

	it("formats multi-task chain calls with numbered list", () => {
		const comp = renderCall(
			{
				type: "chain",
				tasks: [{ prompt: "step one" }, { prompt: "step two" }],
			} as unknown as Record<string, unknown>,
			theme,
		);
		expect(toText(comp).join("\n")).toContain("steps");
	});
});

describe("renderResult", () => {
	it("falls back to plain text when details are empty", () => {
		const result: AgentToolResult<TaskToolDetails> = {
			content: [{ type: "text", text: "nothing" }],
			details: { mode: "single", results: [] },
		};
		const rendered = toText(
			renderResult(
				result,
				{ expanded: false } as ToolRenderResultOptions,
				theme,
			),
		);
		expect(rendered[0]?.trim()).toBe("nothing");
	});

	it("renders single-result output", () => {
		const result: AgentToolResult<TaskToolDetails> = {
			content: [{ type: "text", text: "single" }],
			details: {
				mode: "single",
				results: [
					baseResult({
						name: "task",
						prompt: "Prompt",
						messages: [
							{ role: "assistant", content: [{ type: "text", text: "all good" }] } as never,
						],
						usage: { ...baseResult({}).usage, turns: 2, output: 120, cost: 0.02 },
					}),
				],
			},
		};
		const output = toText(renderResult(result, { expanded: true } as ToolRenderResultOptions, theme));
		expect(output.join("\n")).toContain("task");
		expect(output.join("\n")).toContain("Output:");
	});

	it("renders parallel summaries with status and totals", () => {
		const result: AgentToolResult<TaskToolDetails> = {
			content: [{ type: "text", text: "parallel" }],
			details: {
				mode: "parallel",
				results: [
					baseResult({
						name: "first",
						exitCode: 0,
						messages: [{ role: "assistant", content: [{ type: "text", text: "ok" }] } as never],
						usage: { ...baseResult({}).usage, turns: 1, output: 200, cost: 0.5 },
					}),
					baseResult({
						name: "second",
						exitCode: 1,
						errorMessage: "bad",
						messages: [{ role: "assistant", content: [{ type: "text", text: "oops" }] } as never],
						usage: { ...baseResult({}).usage, turns: 1, output: 10 },
					}),
				],
			},
		};
		const output = toText(renderResult(result, { expanded: false } as ToolRenderResultOptions, theme));
		expect(output.join("\n")).toContain("task (parallel)");
		expect(output.join("\n")).toContain("error[");
	});
});
