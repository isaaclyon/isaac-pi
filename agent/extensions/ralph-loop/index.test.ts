import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ralphLoopExtension from "./index.js";
import { startRalphRun } from "./engine.js";
import { closeAllRalphDbs } from "./db.js";

vi.mock("./engine.js", () => ({
	startRalphRun: vi.fn(),
}));

type CommandConfig = {
	handler: (args: string, ctx: any) => Promise<void> | void;
};

type ToolConfig = {
	name: string;
	execute: (id: string, params: Record<string, unknown>) => Promise<any>;
};

function makeCommandCtx(cwd: string, hasUI = true) {
	return {
		cwd,
		hasUI,
		ui: {
			notify: vi.fn(),
			setStatus: vi.fn(),
		},
	};
}

describe("ralph-loop extension", () => {
	afterEach(() => {
		vi.clearAllMocks();
		closeAllRalphDbs();
		delete process.env.PI_RALPH_ENABLED;
		delete process.env.PI_RALPH_DB_PATH;
	});

	it("registers lifecycle handlers, commands, and ralph_loop tool", () => {
		const handlers: Record<string, unknown> = {};
		const registerCommand = vi.fn();
		const registerTool = vi.fn();
		const pi = {
			on: vi.fn((name: string, handler: unknown) => {
				handlers[name] = handler;
			}),
			registerCommand,
			registerTool,
			sendUserMessage: vi.fn(),
		} as unknown as ExtensionAPI;

		ralphLoopExtension(pi);

		expect(typeof handlers.session_start).toBe("function");
		expect(typeof handlers.session_shutdown).toBe("function");
		expect(registerCommand).toHaveBeenCalledWith("ralph-start", expect.any(Object));
		expect(registerCommand).toHaveBeenCalledWith("ralph-stop", expect.any(Object));
		expect(registerCommand).toHaveBeenCalledWith("ralph-status", expect.any(Object));
		expect(registerCommand).toHaveBeenCalledWith("ralph-runs", expect.any(Object));
		expect(registerTool).toHaveBeenCalledTimes(1);
		expect(registerTool.mock.calls[0]?.[0]?.name).toBe("ralph_loop");
	});

	it("ralph_loop tool executes start/stop/status/runs actions", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-tool-"));
		process.env.PI_RALPH_ENABLED = "1";
		process.env.PI_RALPH_DB_PATH = join(dir, "ralph.sqlite");

		let tool: ToolConfig | undefined;
		const pi = {
			on: vi.fn(),
			registerCommand: vi.fn(),
			registerTool: vi.fn((cfg: ToolConfig) => {
				tool = cfg;
			}),
			sendUserMessage: vi.fn(),
		} as unknown as ExtensionAPI;

		const completion = new Promise<void>(() => {});
		vi.mocked(startRalphRun).mockReturnValue({ runId: "ralph_tool_run", completion });

		ralphLoopExtension(pi);

		const startResult = await tool!.execute("id", {
			action: "start",
			cwd: dir,
			task: "Tool-started run",
			maxLoops: 4,
		});
		expect(startResult.isError).not.toBe(true);
		expect(startRalphRun).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({ task: "Tool-started run", maxLoops: 4 }),
			}),
		);

		const firstSignal = vi.mocked(startRalphRun).mock.calls[0]?.[0]?.signal as AbortSignal;
		expect(firstSignal.aborted).toBe(false);

		const statusResult = await tool!.execute("id", { action: "status", cwd: dir, runId: "ralph_tool_run" });
		expect(statusResult.isError).not.toBe(true);
		expect(statusResult.content[0].text).toContain("ralph_tool_run");

		const runsResult = await tool!.execute("id", { action: "runs", cwd: dir });
		expect(runsResult.isError).not.toBe(true);
		expect(runsResult.content[0].text).toContain("No Ralph runs found");

		const stopResult = await tool!.execute("id", { action: "stop", cwd: dir, runId: "ralph_tool_run" });
		expect(stopResult.isError).not.toBe(true);
		expect(firstSignal.aborted).toBe(true);

		rmSync(dir, { recursive: true, force: true });
	});

	it("/ralph-start launches run in background and /ralph-stop signals abort", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-stage4-"));
		process.env.PI_RALPH_ENABLED = "1";
		process.env.PI_RALPH_DB_PATH = join(dir, "ralph.sqlite");

		const handlers: Record<string, (event: unknown, ctx: any) => void> = {};
		const commands: Record<string, CommandConfig> = {};
		const pi = {
			on: vi.fn((name: string, handler: any) => {
				handlers[name] = handler;
			}),
			registerCommand: vi.fn((name: string, cfg: CommandConfig) => {
				commands[name] = cfg;
			}),
			registerTool: vi.fn(),
			sendUserMessage: vi.fn(),
		} as unknown as ExtensionAPI;

		const completion = new Promise<void>(() => {});
		vi.mocked(startRalphRun).mockReturnValue({ runId: "ralph_test", completion });

		ralphLoopExtension(pi);

		const startCtx = makeCommandCtx(dir, true);
		handlers.session_start?.({}, startCtx);

		await commands["ralph-start"].handler('{"task":"Ship Stage 4","maxLoops":2}', startCtx);
		expect(startRalphRun).toHaveBeenCalledWith(
			expect.objectContaining({
				config: expect.objectContaining({
					task: "Ship Stage 4",
					maxLoops: 2,
				}),
			}),
		);
		expect(startCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Started Ralph run ralph_test"), "info");

		await commands["ralph-stop"].handler("", startCtx);
		expect(startCtx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Stop signal sent for ralph_test"), "warning");

		rmSync(dir, { recursive: true, force: true });
	});

	it("aborts old active runs when runtime db path changes", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-stage4-swap-"));
		process.env.PI_RALPH_ENABLED = "1";
		process.env.PI_RALPH_DB_PATH = join(dir, "one.sqlite");

		const handlers: Record<string, (event: unknown, ctx: any) => void> = {};
		const commands: Record<string, CommandConfig> = {};
		const pi = {
			on: vi.fn((name: string, handler: any) => {
				handlers[name] = handler;
			}),
			registerCommand: vi.fn((name: string, cfg: CommandConfig) => {
				commands[name] = cfg;
			}),
			registerTool: vi.fn(),
			sendUserMessage: vi.fn(),
		} as unknown as ExtensionAPI;

		const completion = new Promise<void>(() => {});
		vi.mocked(startRalphRun).mockReturnValue({ runId: "ralph_test", completion });

		ralphLoopExtension(pi);
		const ctx = makeCommandCtx(dir, true);
		handlers.session_start?.({}, ctx);
		await commands["ralph-start"].handler('{"task":"run","maxLoops":2}', ctx);

		const firstSignal = vi.mocked(startRalphRun).mock.calls[0]?.[0]?.signal as AbortSignal;
		expect(firstSignal.aborted).toBe(false);

		process.env.PI_RALPH_DB_PATH = join(dir, "two.sqlite");
		await commands["ralph-status"].handler("", ctx);

		expect(firstSignal.aborted).toBe(true);

		rmSync(dir, { recursive: true, force: true });
	});

	it("rejects malformed inline success overrides before run starts", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-stage4-invalid-success-"));
		process.env.PI_RALPH_ENABLED = "1";
		process.env.PI_RALPH_DB_PATH = join(dir, "ralph.sqlite");

		const handlers: Record<string, (event: unknown, ctx: any) => void> = {};
		const commands: Record<string, CommandConfig> = {};
		const pi = {
			on: vi.fn((name: string, handler: any) => {
				handlers[name] = handler;
			}),
			registerCommand: vi.fn((name: string, cfg: CommandConfig) => {
				commands[name] = cfg;
			}),
			registerTool: vi.fn(),
			sendUserMessage: vi.fn(),
		} as unknown as ExtensionAPI;

		vi.mocked(startRalphRun).mockReturnValue({ runId: "ralph_test", completion: Promise.resolve() });

		ralphLoopExtension(pi);
		const ctx = makeCommandCtx(dir, true);
		handlers.session_start?.({}, ctx);

		await commands["ralph-start"].handler('{"task":"run","success":{"mode":"quantitative","checks":"bad"}}', ctx);
		await commands["ralph-start"].handler('{"task":"run","success":{"mode":"quantitative","checks":[{"command":"echo ok","expectedExitCode":"zero"}]}}', ctx);

		expect(startRalphRun).not.toHaveBeenCalled();
		expect(ctx.ui.notify).toHaveBeenCalledWith(expect.stringContaining("Invalid Ralph config"), "error");

		rmSync(dir, { recursive: true, force: true });
	});

	it("degrades cleanly in non-UI mode", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-stage4-noui-"));
		process.env.PI_RALPH_ENABLED = "1";
		process.env.PI_RALPH_DB_PATH = join(dir, "ralph.sqlite");

		const handlers: Record<string, (event: unknown, ctx: any) => void> = {};
		const commands: Record<string, CommandConfig> = {};
		const pi = {
			on: vi.fn((name: string, handler: any) => {
				handlers[name] = handler;
			}),
			registerCommand: vi.fn((name: string, cfg: CommandConfig) => {
				commands[name] = cfg;
			}),
			registerTool: vi.fn(),
			sendUserMessage: vi.fn(),
		} as unknown as ExtensionAPI;

		vi.mocked(startRalphRun).mockReturnValue({ runId: "ralph_test", completion: Promise.resolve() });

		ralphLoopExtension(pi);

		const ctx = makeCommandCtx(dir, false);
		handlers.session_start?.({}, ctx);
		await commands["ralph-runs"].handler("", ctx);

		expect(pi.sendUserMessage).toHaveBeenCalled();

		handlers.session_shutdown?.({}, ctx);
		rmSync(dir, { recursive: true, force: true });
	});
});
