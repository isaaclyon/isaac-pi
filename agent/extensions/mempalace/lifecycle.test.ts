import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerMempalaceLifecycleHooks } from "./lifecycle.js";

function getRegisteredHandler(on: ReturnType<typeof vi.fn>, eventName: string) {
	const call = on.mock.calls.find(([name]) => name === eventName);
	if (!call) {
		throw new Error(`Expected handler for ${eventName}`);
	}
	return call[1] as (...args: unknown[]) => Promise<unknown>;
}

describe("registerMempalaceLifecycleHooks", () => {
	it("registers auto-sync and recall hooks", () => {
		const on = vi.fn();
		const pi = { on } as unknown as ExtensionAPI;

		registerMempalaceLifecycleHooks(pi, {
			getStatus: vi.fn(),
			search: vi.fn(),
			sync: vi.fn(),
		});

		expect(on).toHaveBeenCalledTimes(3);
		expect(on.mock.calls.map(([name]) => name)).toEqual([
			"session_shutdown",
			"session_before_compact",
			"before_agent_start",
		]);
	});

	it("syncs project memory on shutdown and before compaction", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-lifecycle-"));
		const on = vi.fn();
		const sync = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "Synced" }],
		});
		const pi = { on } as unknown as ExtensionAPI;
		const ctx = {
			cwd: root,
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: {},
		};

		registerMempalaceLifecycleHooks(pi, {
			getStatus: vi.fn(),
			search: vi.fn(),
			sync,
		});

		getRegisteredHandler(on, "session_shutdown")({}, ctx);
		await Promise.resolve();
		await Promise.resolve();
		getRegisteredHandler(on, "session_before_compact")({}, ctx);

		expect(sync).toHaveBeenCalledTimes(2);
		expect(sync).toHaveBeenNthCalledWith(1, ctx);
		expect(sync).toHaveBeenNthCalledWith(2, ctx);
		expect(ctx.ui.notify).not.toHaveBeenCalled();
	});

	it("coalesces overlapping auto-sync requests", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-lifecycle-"));
		const on = vi.fn();
		let resolveSync!: () => void;
		const sync = vi.fn(
			() =>
				new Promise<{ content: Array<{ type: string; text: string }> }>((resolve) => {
					resolveSync = () => resolve({ content: [{ type: "text", text: "Synced" }] });
				}),
			);
		const pi = { on } as unknown as ExtensionAPI;
		const ctx = {
			cwd: root,
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: {},
		};

		registerMempalaceLifecycleHooks(pi, {
			getStatus: vi.fn(),
			search: vi.fn(),
			sync,
		});

		getRegisteredHandler(on, "session_shutdown")({}, ctx);
		getRegisteredHandler(on, "session_before_compact")({}, ctx);

		await Promise.resolve();
		expect(sync).toHaveBeenCalledTimes(1);

		resolveSync();
		await Promise.resolve();
		await Promise.resolve();

		expect(sync).toHaveBeenCalledTimes(1);
	});

	it("coalesces overlapping auto-sync requests across cwd aliases", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-lifecycle-"));
		const alias = path.join(root, "alias");
		symlinkSync(root, alias, "dir");

		const on = vi.fn();
		let resolveSync!: () => void;
		const sync = vi.fn(
			() =>
				new Promise<{ content: Array<{ type: string; text: string }> }>((resolve) => {
					resolveSync = () => resolve({ content: [{ type: "text", text: "Synced" }] });
				}),
			);
		const pi = { on } as unknown as ExtensionAPI;
		const realCtx = {
			cwd: root,
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: {},
		};
		const aliasCtx = {
			cwd: alias,
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: {},
		};

		registerMempalaceLifecycleHooks(pi, {
			getStatus: vi.fn(),
			search: vi.fn(),
			sync,
		});

		getRegisteredHandler(on, "session_shutdown")({}, realCtx);
		getRegisteredHandler(on, "session_before_compact")({}, aliasCtx);

		await Promise.resolve();
		expect(sync).toHaveBeenCalledTimes(1);

		resolveSync();
		await Promise.resolve();
		await Promise.resolve();

		expect(sync).toHaveBeenCalledTimes(1);
	});

	it("does not inject recall by default", async () => {
		const on = vi.fn();
		const search = vi.fn();
		const pi = { on } as unknown as ExtensionAPI;
		const ctx = {
			cwd: "/repo",
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: {},
		};

		registerMempalaceLifecycleHooks(pi, {
			getStatus: vi.fn(),
			search,
			sync: vi.fn(),
		});

		const result = await getRegisteredHandler(on, "before_agent_start")(
			{ prompt: "Why did we switch auth providers?", systemPrompt: "Base prompt" },
			ctx,
		);

		expect(search).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it("emits debug notifications for auto-sync and recall injection", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-lifecycle-"));
		const on = vi.fn();
		const sync = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "Synced" }],
			details: { mempalace: { action: "sync", bootstrapped: true } },
		});
		const search = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "- Chose Clerk over Auth0" }],
			details: { mempalace: { action: "search", bootstrapped: false, query: "Why did we switch auth providers?" } },
		});
		const pi = { on } as unknown as ExtensionAPI;
		const ctx = {
			cwd: root,
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: {},
		};

		registerMempalaceLifecycleHooks(
			pi,
			{
				getStatus: vi.fn(),
				search,
				sync,
			},
			{ enabled: true },
			{ mode: "selective" },
		);

		await getRegisteredHandler(on, "session_shutdown")({}, ctx);
		const result = await getRegisteredHandler(on, "before_agent_start")(
			{ prompt: "Why did we switch auth providers?", systemPrompt: "Base prompt" },
			ctx,
		);

		expect(result).toEqual({
			message: {
				customType: "mempalace-recall",
				content: expect.stringContaining("Chose Clerk over Auth0"),
				display: false,
			},
		});
		expect(ctx.ui.notify.mock.calls).toEqual([
			["MemPalace: auto-sync (shutdown)", "info"],
			["MemPalace: sync", "info"],
			["MemPalace: auto-init repo", "info"],
			["MemPalace: recall lookup", "info"],
			["MemPalace: search 'Why did we switch auth providers?'", "info"],
			["MemPalace: recall injected", "info"],
		]);
	});

	it("injects a hidden recall message in selective mode", async () => {
		const on = vi.fn();
		const search = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "- Chose Clerk over Auth0\n- Added automatic session sync" }],
		});
		const pi = { on } as unknown as ExtensionAPI;
		const ctx = {
			cwd: "/repo",
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: {},
		};

		registerMempalaceLifecycleHooks(
			pi,
			{
				getStatus: vi.fn(),
				search,
				sync: vi.fn(),
			},
			{ enabled: false },
			{ mode: "selective" },
		);

		const result = await getRegisteredHandler(on, "before_agent_start")(
			{ prompt: "Why did we switch auth providers?", systemPrompt: "Base prompt" },
			ctx,
		);

		expect(search).toHaveBeenCalledWith(expect.objectContaining({ cwd: "/repo" }), "Why did we switch auth providers?");
		expect(result).toEqual({
			message: {
				customType: "mempalace-recall",
				content: expect.stringContaining("Chose Clerk over Auth0"),
				display: false,
			},
		});
	});

	it("injects recall for multiline natural-language prompts", async () => {
		const on = vi.fn();
		const search = vi.fn().mockResolvedValue({
			content: [{ type: "text", text: "- Chose Clerk over Auth0\n- Added automatic session sync" }],
		});
		const pi = { on } as unknown as ExtensionAPI;
		const ctx = {
			cwd: "/repo",
			hasUI: true,
			ui: { notify: vi.fn() },
			sessionManager: {},
		};

		registerMempalaceLifecycleHooks(
			pi,
			{
				getStatus: vi.fn(),
				search,
				sync: vi.fn(),
			},
			{ enabled: false },
			{ mode: "selective" },
		);

		const result = await getRegisteredHandler(on, "before_agent_start")(
			{ prompt: "Can you remind me why we switched auth?\nI need the rationale.", systemPrompt: "Base prompt" },
			ctx,
		);

		expect(search).toHaveBeenCalledWith(
			expect.objectContaining({ cwd: "/repo" }),
			"Can you remind me why we switched auth? I need the rationale.",
		);
		expect(result).toEqual({
			message: {
				customType: "mempalace-recall",
				content: expect.stringContaining("Chose Clerk over Auth0"),
				display: false,
			},
		});
	});

	it("skips recall injection for slash commands", async () => {
		const on = vi.fn();
		const search = vi.fn();
		const pi = { on } as unknown as ExtensionAPI;

		registerMempalaceLifecycleHooks(pi, {
			getStatus: vi.fn(),
			search,
			sync: vi.fn(),
		});

		const result = await getRegisteredHandler(on, "before_agent_start")(
			{ prompt: "/reload", systemPrompt: "Base prompt" },
			{ cwd: "/repo", hasUI: true, ui: { notify: vi.fn() }, sessionManager: {} },
		);

		expect(search).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it("skips recall injection for code-like prompts", async () => {
		const on = vi.fn();
		const search = vi.fn();
		const pi = { on } as unknown as ExtensionAPI;

		registerMempalaceLifecycleHooks(pi, {
			getStatus: vi.fn(),
			search,
			sync: vi.fn(),
		});

		const result = await getRegisteredHandler(on, "before_agent_start")(
			{ prompt: "Here is the snippet:\nconst value = 1;", systemPrompt: "Base prompt" },
			{ cwd: "/repo", hasUI: true, ui: { notify: vi.fn() }, sessionManager: {} },
		);

		expect(search).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});
});
