import { afterEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import githubLifecycleExtension from "./index.js";
import { TRACKER_STATE_TYPE } from "./state.js";

function buildPrJson(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		number: 123,
		title: "Add PR lifecycle tracker",
		url: "https://github.com/acme/widgets/pull/123",
		state: "OPEN",
		isDraft: false,
		mergedAt: null,
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		statusCheckRollup: [],
		headRefName: "feature/pr-tracker",
		baseRefName: "main",
		updatedAt: "2026-04-08T22:00:00Z",
		...overrides,
	});
}

type RegisteredCommand = { description: string; handler: (args: string, ctx: any) => Promise<void> };
type EventHandler = (event: any, ctx: any) => Promise<void>;

describe("github lifecycle extension", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("registers commands and a custom message renderer", () => {
		const registerCommand = vi.fn();
		const registerMessageRenderer = vi.fn();
		const on = vi.fn();
		const pi = {
			registerCommand,
			registerMessageRenderer,
			on,
		} as unknown as ExtensionAPI;

		githubLifecycleExtension(pi);

		expect(registerCommand).toHaveBeenCalledWith("pr-track", expect.any(Object));
		expect(registerCommand).toHaveBeenCalledWith("pr-untrack", expect.any(Object));
		expect(registerCommand).toHaveBeenCalledWith("pr-status", expect.any(Object));
		expect(registerCommand).toHaveBeenCalledWith("pr-refresh", expect.any(Object));
		expect(registerMessageRenderer).toHaveBeenCalledWith("github-pr-event", expect.any(Function));
		expect(on).toHaveBeenCalledWith("tool_result", expect.any(Function));
	});

	it("tracks a PR manually and persists session state", async () => {
		const commands = new Map<string, RegisteredCommand>();
		const registerCommand = vi.fn((name: string, cfg: RegisteredCommand) => commands.set(name, cfg));
		const registerMessageRenderer = vi.fn();
		const handlers = new Map<string, EventHandler>();
		const on = vi.fn((name: string, handler: EventHandler) => handlers.set(name, handler));
		const exec = vi.fn().mockResolvedValue({ code: 0, stdout: buildPrJson(), stderr: "", killed: false });
		const appendEntry = vi.fn();
		const sendMessage = vi.fn();
		const pi = {
			registerCommand,
			registerMessageRenderer,
			on,
			exec,
			appendEntry,
			sendMessage,
		} as unknown as ExtensionAPI;

		githubLifecycleExtension(pi);

		const ctx = {
			cwd: "/tmp/repo",
			hasUI: true,
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
				theme: { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text },
			},
			sessionManager: { getEntries: () => [], getBranch: () => [] },
		};

		await commands.get("pr-track")!.handler("", ctx);

		expect(exec).toHaveBeenCalledWith("gh", ["pr", "view", "--json", expect.stringContaining("statusCheckRollup")], { cwd: "/tmp/repo", timeout: 10_000 });
		expect(appendEntry).toHaveBeenCalledWith(
			TRACKER_STATE_TYPE,
			expect.objectContaining({ trackedPr: { repo: "acme/widgets", prNumber: 123 } }),
		);
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("github-pr", "PR #123 • open");
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ customType: "github-pr-event", display: true }),
			expect.objectContaining({ triggerTurn: false }),
		);
	});

	it("auto-tracks a newly created PR from gh pr create", async () => {
		const handlers = new Map<string, EventHandler>();
		const on = vi.fn((name: string, handler: EventHandler) => handlers.set(name, handler));
		const exec = vi.fn().mockResolvedValue({ code: 0, stdout: buildPrJson(), stderr: "", killed: false });
		const appendEntry = vi.fn();
		const sendMessage = vi.fn();
		const pi = {
			registerCommand: vi.fn(),
			registerMessageRenderer: vi.fn(),
			on,
			exec,
			appendEntry,
			sendMessage,
		} as unknown as ExtensionAPI;

		githubLifecycleExtension(pi);

		const ctx = {
			cwd: "/tmp/repo",
			hasUI: true,
			ui: {
				setStatus: vi.fn(),
				notify: vi.fn(),
				theme: { fg: (_color: string, text: string) => text, bg: (_color: string, text: string) => text, bold: (text: string) => text },
			},
			sessionManager: { getEntries: () => [], getBranch: () => [] },
		};

		await handlers.get("tool_result")!(
			{ toolName: "bash", isError: false, input: { command: "gh pr create --fill" } },
			ctx,
		);

		expect(exec).toHaveBeenCalledTimes(1);
		expect(appendEntry).toHaveBeenCalledWith(
			TRACKER_STATE_TYPE,
			expect.objectContaining({ trackingSource: "auto" }),
		);
		expect(sendMessage).toHaveBeenCalledWith(
			expect.objectContaining({ content: expect.stringContaining("Tracking PR #123") }),
			expect.any(Object),
		);
	});
});
