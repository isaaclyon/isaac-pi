import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWorktreeTools } from "./register-tools.js";
import * as createModule from "./create.js";
import * as listModule from "./list.js";
import * as removeModule from "./remove.js";
import * as syncModule from "./sync.js";

type ToolConfig = {
	name: string;
	execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
};

describe("worktree tools registration", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers all four tools", () => {
		const registerTool = vi.fn();
		const pi = { registerTool } as unknown as ExtensionAPI;
		registerWorktreeTools(pi);

		const names = registerTool.mock.calls.map((call) => call?.[0]?.name);
		expect(names).toEqual([
			"worktree_create",
			"worktree_remove",
			"worktree_list",
			"worktree_sync",
		]);
	});

	it("executes worktree_create with user-facing summary", async () => {
		const tools: Record<string, ToolConfig> = {};
		const registerTool = vi.fn((cfg: ToolConfig) => {
			tools[cfg.name] = cfg;
		});
		const pi = { registerTool } as unknown as ExtensionAPI;
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

		const result = await tools.worktree_create.execute("id", { branch: "feature" } as Record<string, unknown>);
		expect(result?.content?.[0]?.text).toContain("Created worktree for 'feature'");
		expect(result?.content?.[0]?.text).toContain("Path: /tmp/x");
		expect(result?.content?.[0]?.text).toContain("Deps installed via: pnpm");
	});

	it("reports worktree_remove output and warnings", async () => {
		const tools: Record<string, ToolConfig> = {};
		const registerTool = vi.fn((cfg: ToolConfig) => {
			tools[cfg.name] = cfg;
		});
		const pi = { registerTool } as unknown as ExtensionAPI;
		registerWorktreeTools(pi);

		vi.spyOn(removeModule, "worktreeRemove").mockResolvedValue({
			ok: true,
			path: "/tmp/x",
			branch: "feature",
			branchDeleted: true,
			warnings: ["stale refs"],
		});

		const result = await tools.worktree_remove.execute("id", { branch: "feature" } as Record<string, unknown>);
		expect(result?.content?.[0]?.text).toContain("Removed worktree at /tmp/x");
		expect(result?.content?.[0]?.text).toContain("Warnings:");
	});

	it("reports list and sync summaries", async () => {
		const tools: Record<string, ToolConfig> = {};
		const registerTool = vi.fn((cfg: ToolConfig) => {
			tools[cfg.name] = cfg;
		});
		const pi = { registerTool } as unknown as ExtensionAPI;
		registerWorktreeTools(pi);

		vi.spyOn(listModule, "worktreeList").mockResolvedValue([]);
		const listResult = await tools.worktree_list.execute("id", {});
		expect(listResult?.content?.[0]?.text).toBe("No worktrees found.");

		vi.spyOn(syncModule, "worktreeSync").mockResolvedValue({ ok: true, defaultBranch: "main", results: [] });
		const syncResult = await tools.worktree_sync.execute("id", {});
		expect(syncResult?.content?.[0]?.text).toContain("No worktrees to sync.");
		await expect(tools.worktree_sync.execute("id", { branch: "main" })).resolves.toBeDefined();
	});
});
