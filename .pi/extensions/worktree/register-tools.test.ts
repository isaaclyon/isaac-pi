import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWorktreeTools } from "./register-tools.js";
import * as createModule from "./create.js";
import * as listModule from "./list.js";
import * as removeModule from "./remove.js";
import * as syncModule from "./sync.js";

type ToolConfig = {
	name: string;
	execute: (id: string, params: Record<string, unknown>) => Promise<any>;
};

type CommandConfig = {
	handler: (args: string, ctx: { ui: { notify: (message: string, type: "info" | "warning" | "error") => void } }) => Promise<void>;
};

describe("worktree tools registration", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers unified worktree tool and /worktree command", () => {
		const registerTool = vi.fn();
		const registerCommand = vi.fn();
		const pi = { registerTool, registerCommand } as unknown as ExtensionAPI;
		registerWorktreeTools(pi);

		expect(registerTool).toHaveBeenCalledTimes(1);
		expect(registerTool.mock.calls[0]?.[0]?.name).toBe("worktree");

		expect(registerCommand).toHaveBeenCalledTimes(1);
		expect(registerCommand.mock.calls[0]?.[0]).toBe("worktree");
	});

	it("executes create action with user-facing summary", async () => {
		let tool: ToolConfig | undefined;
		const registerTool = vi.fn((cfg: ToolConfig) => {
			tool = cfg;
		});
		const registerCommand = vi.fn();
		const pi = { registerTool, registerCommand } as unknown as ExtensionAPI;
		registerWorktreeTools(pi);

		vi.spyOn(createModule, "worktreeCreate").mockResolvedValue({
			ok: true,
			path: "/tmp/x",
			branch: "feature",
			created: true,
			packageManager: "pnpm",
			configFilesCopied: [".env", ".worktree-config"],
			gitignoreModified: true,
			direnvAllowRan: false,
			direnvAllowSuccess: true,
		});

		const result = await tool!.execute("id", { action: "create", branch: "feature" });
		expect(result?.content?.[0]?.text).toContain("Created worktree for 'feature'");
		expect(result?.content?.[0]?.text).toContain("Path: /tmp/x");
		expect(result?.content?.[0]?.text).toContain("Deps installed via: pnpm");
	});

	it("reports remove/list/sync summaries from the unified tool", async () => {
		let tool: ToolConfig | undefined;
		const registerTool = vi.fn((cfg: ToolConfig) => {
			tool = cfg;
		});
		const registerCommand = vi.fn();
		const pi = { registerTool, registerCommand } as unknown as ExtensionAPI;
		registerWorktreeTools(pi);

		vi.spyOn(removeModule, "worktreeRemove").mockResolvedValue({
			ok: true,
			path: "/tmp/x",
			branch: "feature",
			branchDeleted: true,
			warnings: ["stale refs"],
		});
		const removeResult = await tool!.execute("id", { action: "remove", branch: "feature" });
		expect(removeResult?.content?.[0]?.text).toContain("Removed worktree at /tmp/x");
		expect(removeResult?.content?.[0]?.text).toContain("Warnings:");

		vi.spyOn(listModule, "worktreeList").mockResolvedValue([]);
		const listResult = await tool!.execute("id", { action: "list" });
		expect(listResult?.content?.[0]?.text).toBe("No worktrees found.");

		vi.spyOn(syncModule, "worktreeSync").mockResolvedValue({ ok: true, defaultBranch: "main", results: [] });
		const syncResult = await tool!.execute("id", { action: "sync" });
		expect(syncResult?.content?.[0]?.text).toContain("No worktrees to sync.");
		await expect(tool!.execute("id", { action: "sync", branch: "main" })).resolves.toBeDefined();
	});

	it("validates missing branch for create/remove", async () => {
		let tool: ToolConfig | undefined;
		const registerTool = vi.fn((cfg: ToolConfig) => {
			tool = cfg;
		});
		const registerCommand = vi.fn();
		const pi = { registerTool, registerCommand } as unknown as ExtensionAPI;
		registerWorktreeTools(pi);

		const createResult = await tool!.execute("id", { action: "create" });
		expect(createResult?.isError).toBe(true);
		expect(createResult?.content?.[0]?.text).toContain("Action 'create' requires 'branch'");

		const removeResult = await tool!.execute("id", { action: "remove" });
		expect(removeResult?.isError).toBe(true);
		expect(removeResult?.content?.[0]?.text).toContain("Action 'remove' requires 'branch'");
	});

	it("/worktree command parses args and notifies result", async () => {
		let command: CommandConfig | undefined;
		const registerTool = vi.fn();
		const registerCommand = vi.fn((_name: string, cfg: CommandConfig) => {
			command = cfg;
		});
		const pi = { registerTool, registerCommand } as unknown as ExtensionAPI;
		registerWorktreeTools(pi);

		const notify = vi.fn();
		vi.spyOn(listModule, "worktreeList").mockResolvedValue([]);
		await command!.handler("list", { ui: { notify } });
		expect(notify).toHaveBeenCalledWith("No worktrees found.", "info");

		await command!.handler("unknown", { ui: { notify } });
		expect(notify).toHaveBeenCalledWith(expect.stringContaining("Unknown action 'unknown'"), "error");
	});
});
