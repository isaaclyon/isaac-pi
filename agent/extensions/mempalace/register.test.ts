import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerMempalaceExtension } from "./register.js";

type ToolConfig = {
	name: string;
	execute: (id: string, params: Record<string, unknown>, signal: AbortSignal | undefined, onUpdate: unknown, ctx: any) => Promise<any>;
};

type CommandConfig = {
	handler: (args: string, ctx: any) => Promise<void>;
};

describe("registerMempalaceExtension", () => {
	it("registers memory tools and commands", () => {
		const registerTool = vi.fn();
		const registerCommand = vi.fn();
		const on = vi.fn();
		const pi = { registerTool, registerCommand, on } as unknown as ExtensionAPI;

		registerMempalaceExtension(pi, {
			getStatus: vi.fn(),
			search: vi.fn(),
			sync: vi.fn(),
		});

		expect(registerTool).toHaveBeenCalledTimes(3);
		expect(registerTool.mock.calls.map((call) => call[0].name)).toEqual([
			"project_memory_status",
			"project_memory_sync",
			"project_memory_search",
		]);
		expect(registerCommand).toHaveBeenCalledTimes(5);
		expect(registerCommand.mock.calls.map((call) => call[0])).toEqual([
			"memory-status",
			"memory-sync",
			"memory-search",
			"memory-debug",
			"memory-mode",
		]);
		expect(on).toHaveBeenCalledTimes(3);
		expect(on.mock.calls.map((call) => call[0])).toEqual([
			"session_shutdown",
			"session_before_compact",
			"before_agent_start",
		]);
	});

	it("executes the search tool and returns the operation result", async () => {
		let searchTool: ToolConfig | undefined;
		const registerTool = vi.fn((cfg: ToolConfig) => {
			if (cfg.name === "project_memory_search") searchTool = cfg;
		});
		const registerCommand = vi.fn();
		const on = vi.fn();
		const pi = { registerTool, registerCommand, on } as unknown as ExtensionAPI;
		const search = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "Found memory" }],
			details: { hits: 1 },
		});

		registerMempalaceExtension(pi, {
			getStatus: vi.fn(),
			search,
			sync: vi.fn(),
		});

		const result = await searchTool!.execute("id", { query: "auth decision" }, undefined, undefined, { cwd: "/repo" });
		expect(search).toHaveBeenCalledWith({ cwd: "/repo" }, "auth decision");
		expect(result).toEqual({
			content: [{ type: "text", text: "Found memory" }],
			details: { hits: 1 },
		});
	});

	it("sets memory mode for the session", async () => {
		let modeCommand: CommandConfig | undefined;
		const registerTool = vi.fn();
		const registerCommand = vi.fn((name: string, cfg: CommandConfig) => {
			if (name === "memory-mode") modeCommand = cfg;
		});
		const on = vi.fn();
		const pi = { registerTool, registerCommand, on } as unknown as ExtensionAPI;

		registerMempalaceExtension(pi, {
			getStatus: vi.fn(),
			search: vi.fn(),
			sync: vi.fn(),
		});

		const notify = vi.fn();
		await modeCommand!.handler("selective", { cwd: "/repo", ui: { notify } });
		expect(notify).toHaveBeenCalledWith("MemPalace mode: selective", "info");
	});

	it("rejects invalid memory mode values", async () => {
		let modeCommand: CommandConfig | undefined;
		const registerTool = vi.fn();
		const registerCommand = vi.fn((name: string, cfg: CommandConfig) => {
			if (name === "memory-mode") modeCommand = cfg;
		});
		const on = vi.fn();
		const pi = { registerTool, registerCommand, on } as unknown as ExtensionAPI;

		registerMempalaceExtension(pi, {
			getStatus: vi.fn(),
			search: vi.fn(),
			sync: vi.fn(),
		});

		const notify = vi.fn();
		await modeCommand!.handler("banana", { cwd: "/repo", ui: { notify } });
		expect(notify).toHaveBeenCalledWith("Usage: /memory-mode <wake-only|selective>", "error");
	});

	it("toggles debug mode and emits debug notifications for commands", async () => {
		let debugCommand: CommandConfig | undefined;
		let statusCommand: CommandConfig | undefined;
		const registerTool = vi.fn();
		const registerCommand = vi.fn((name: string, cfg: CommandConfig) => {
			if (name === "memory-debug") debugCommand = cfg;
			if (name === "memory-status") statusCommand = cfg;
		});
		const on = vi.fn();
		const pi = { registerTool, registerCommand, on } as unknown as ExtensionAPI;
		const getStatus = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "MemPalace unavailable" }],
			details: { mempalace: { action: "status", bootstrapped: true } },
		});

		registerMempalaceExtension(pi, {
			getStatus,
			search: vi.fn(),
			sync: vi.fn(),
		});

		const notify = vi.fn();
		const ctx = { cwd: "/repo", ui: { notify } };
		await debugCommand!.handler("", ctx);
		await statusCommand!.handler("", ctx);
		expect(getStatus).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo" }));
		expect(notify.mock.calls).toEqual([
			["MemPalace debug: on", "info"],
			["MemPalace: status", "info"],
			["MemPalace: auto-init repo", "info"],
			["MemPalace unavailable", "info"],
		]);
	});
});
