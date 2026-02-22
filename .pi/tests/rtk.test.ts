import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import rtkExtension from "../extensions/rtk.js";

type EventHandler = (event: any, ctx: any) => Promise<any> | any;

type CommandHandler = {
	description: string;
	handler: (_args: unknown, ctx: any) => Promise<void> | void;
};

describe("rtk extension", () => {
	let handlers: Record<string, EventHandler>;
	let commands: Record<string, CommandHandler>;
	let notify: ReturnType<typeof vi.fn>;
	let pi: ExtensionAPI;
	let ctx: any;

	beforeEach(() => {
		handlers = {};
		commands = {};
		notify = vi.fn();
		ctx = {
			cwd: process.cwd(),
			hasUI: false,
			ui: { notify },
		};

		pi = {
			on: vi.fn((event: string, handler: EventHandler) => {
				handlers[event] = handler;
			}),
			registerCommand: vi.fn((name: string, command: CommandHandler) => {
				commands[name] = command;
			}),
		} as unknown as ExtensionAPI;

		rtkExtension(pi);
	});

	it("groups grep output by file", async () => {
		await handlers.session_start({}, ctx);

		const result = await handlers.tool_result(
			{
				type: "tool_result",
				toolCallId: "1",
				toolName: "grep",
				input: { pattern: "TODO" },
				content: [
					{
						type: "text",
						text: "src/a.ts:3:TODO one\nsrc/b.ts:8:TODO two\nsrc/a.ts:12:TODO three",
					},
				],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		expect(result.content[0].text).toContain("Search results grouped");
		expect(result.content[0].text).toContain("src/a.ts (2)");
		expect(result.content[0].text).toContain("src/b.ts (1)");
	});

	it("filters source comments on read results", async () => {
		await handlers.session_start({}, ctx);

		const result = await handlers.tool_result(
			{
				type: "tool_result",
				toolCallId: "2",
				toolName: "read",
				input: { path: "src/example.ts" },
				content: [
					{
						type: "text",
						text: "// remove me\nconst a = 1;\n/* remove block */\nconst b = 2;",
					},
				],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		const text = result.content[0].text as string;
		expect(text).not.toContain("// remove me");
		expect(text).not.toContain("/* remove block */");
		expect(text).toContain("const a = 1;");
		expect(text).toContain("const b = 2;");
	});

	it("compacts git diff bash output", async () => {
		await handlers.session_start({}, ctx);

		const result = await handlers.tool_result(
			{
				type: "tool_result",
				toolCallId: "3",
				toolName: "bash",
				input: { command: "git diff" },
				content: [
					{
						type: "text",
						text: [
							"diff --git a/src/a.ts b/src/a.ts",
							"@@ -1 +1 @@",
							"-const a = 1;",
							"+const a = 2;",
						].join("\n"),
					},
				],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		expect(result.content[0].text).toContain("Git diff summary");
		expect(result.content[0].text).toContain("src/a.ts | +1 | -1 | 1");
	});

	it("preserves structured test output when json reporter is requested", async () => {
		await handlers.session_start({}, ctx);
		const json = '{"numTotalTests":4,"numFailedTests":0}';

		const result = await handlers.tool_result(
			{
				type: "tool_result",
				toolCallId: "4",
				toolName: "bash",
				input: { command: "vitest run --reporter=json --outputFile out.json" },
				content: [{ type: "text", text: json }],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		expect(result).toBeUndefined();
	});

	it("does not report build success when output contains failure signals", async () => {
		await handlers.session_start({}, ctx);

		const result = await handlers.tool_result(
			{
				type: "tool_result",
				toolCallId: "5",
				toolName: "bash",
				input: { command: "npm run build" },
				content: [
					{
						type: "text",
						text: ["building assets...", "step 7 failed unexpectedly", "see logs for details"].join("\n"),
					},
				],
				details: undefined,
				isError: true,
			},
			ctx,
		);

		expect(result.content[0].text).toContain("possible errors detected");
		expect(result.content[0].text).toContain("failed unexpectedly");
		expect(result.content[0].text).not.toContain("no errors or warnings detected");
	});

	it("can be toggled off via command", async () => {
		ctx.hasUI = true;
		await handlers.session_start({}, ctx);
		await commands["rtk-toggle"].handler({}, ctx);

		const result = await handlers.tool_result(
			{
				type: "tool_result",
				toolCallId: "4",
				toolName: "grep",
				input: { pattern: "TODO" },
				content: [{ type: "text", text: "src/a.ts:1:TODO" }],
				details: undefined,
				isError: false,
			},
			ctx,
		);

		expect(result).toBeUndefined();
		expect(notify).toHaveBeenCalledWith("RTK disabled", "warning");
	});
});
