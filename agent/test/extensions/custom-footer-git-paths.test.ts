import { afterEach, describe, expect, it, vi } from "vitest";

const mockStat = vi.fn();
const mockReadFile = vi.fn();

vi.mock("node:fs/promises", () => ({
	default: {
		stat: (...args: unknown[]) => mockStat(...args),
		readFile: (...args: unknown[]) => mockReadFile(...args),
	},
	stat: (...args: unknown[]) => mockStat(...args),
	readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import customFooterExtension from "../../extensions/custom-footer.js";

type ExecResult = {
	stdout: string;
	code: number;
};

type FooterFactory = (
	tui: {
		requestRender: () => void;
	},
	theme: {
		fg: (tone: string, text: string) => string;
	},
	footerData: {
		onBranchChange: (handler: () => void) => () => void;
		getGitBranch: () => string | null;
		getExtensionStatuses: () => ReadonlyMap<string, string>;
		getAvailableProviderCount: () => number;
	},
) => {
	render(width: number): string[];
};

function createSessionManager(sessionId: string) {
	return {
		getSessionId: vi.fn(() => sessionId),
	};
}

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { promise, resolve };
}

function createEaccesError(): NodeJS.ErrnoException {
	const error = new Error("permission denied") as NodeJS.ErrnoException;
	error.code = "EACCES";
	return error;
}

function createDirectoryStats(): never {
	return {
		isDirectory: () => true,
		isFile: () => false,
	} as never;
}

afterEach(() => {
	vi.restoreAllMocks();
	mockStat.mockReset();
	mockReadFile.mockReset();
});

describe("custom footer git path resolution", () => {
	it("does not reject when git metadata is temporarily unreadable", async () => {
		mockStat.mockRejectedValue(createEaccesError());

		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
		const exec = vi.fn();
		const pi = {
			on: vi.fn((event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => {
				handlers.set(event, handler);
			}),
			exec,
		} as unknown as ExtensionAPI;

		customFooterExtension(pi);

		const ctx = {
			cwd: "/tmp/repo",
			sessionManager: createSessionManager("session-a"),
			ui: {
				setFooter: vi.fn(),
			},
			model: undefined,
			getContextUsage: vi.fn(),
		} as unknown as ExtensionContext;

		await expect(
			handlers.get("session_start")!({ type: "session_start", reason: "new" }, ctx),
		).resolves.toBeUndefined();
		expect(mockStat).toHaveBeenCalled();
		expect(exec).not.toHaveBeenCalled();
	});

	it("keeps the footer anchored to the newest cwd when an older refresh finishes later", async () => {
		mockStat.mockResolvedValue(createDirectoryStats());

		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
		let footerFactory: unknown;
		const setFooter = vi.fn((factory: unknown) => {
			footerFactory = factory;
		});
		const pendingARev = createDeferred<ExecResult>();
		const pendingAStatus = createDeferred<ExecResult>();
		const exec = vi.fn((command: string, args: string[]) => {
			if (command !== "git") throw new Error(`unexpected command: ${command}`);

			const workTreeIndex = args.indexOf("--work-tree");
			const workTree = workTreeIndex >= 0 ? args[workTreeIndex + 1] : undefined;
			if (workTree === "/tmp/repo-a") {
				return args.includes("rev-parse") ? pendingARev.promise : pendingAStatus.promise;
			}

			if (workTree === "/tmp/repo-b") {
				return Promise.resolve(
					args.includes("rev-parse")
						? { stdout: "/tmp/repo-b", code: 0 }
						: { stdout: "## main...origin/main [ahead 1]\n", code: 0 },
				);
			}

			throw new Error(`unexpected worktree: ${workTree ?? "<missing>"}`);
		});
		const pi = {
			on: vi.fn((event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => {
				handlers.set(event, handler);
			}),
			exec,
		} as unknown as ExtensionAPI;

		customFooterExtension(pi);

		const ctxA = {
			cwd: "/tmp/repo-a",
			sessionManager: createSessionManager("session-a"),
			ui: {
				setFooter,
			},
			model: undefined,
			getContextUsage: vi.fn(() => undefined),
		} as unknown as ExtensionContext;
		const ctxB = {
			cwd: "/tmp/repo-b",
			sessionManager: createSessionManager("session-b"),
			ui: {
				setFooter,
			},
			model: undefined,
			getContextUsage: vi.fn(() => undefined),
		} as unknown as ExtensionContext;

		const startPromise = handlers.get("session_start")!({ type: "session_start", reason: "new" }, ctxA);
		const switchPromise = handlers.get("session_switch")!({ type: "session_switch", reason: "switch" }, ctxB);

		await expect(switchPromise).resolves.toBeUndefined();
		expect(exec.mock.calls.filter(([, args]) => (args as string[]).includes("/tmp/repo-b"))).toHaveLength(2);
		expect(setFooter).toHaveBeenCalledTimes(1);

		pendingARev.resolve({ stdout: "/tmp/repo-a", code: 0 });
		pendingAStatus.resolve({ stdout: "## main...origin/main [behind 1]\n", code: 0 });
		await expect(startPromise).resolves.toBeUndefined();
		expect(setFooter).toHaveBeenCalledTimes(1);

		const theme = {
			fg: (_tone: string, text: string) => text,
		};
		const tui = {
			requestRender: vi.fn(),
		};
		const footerData = {
			onBranchChange: vi.fn(() => vi.fn()),
			getGitBranch: vi.fn(() => "feature/test"),
			getExtensionStatuses: vi.fn(() => new Map()),
			getAvailableProviderCount: vi.fn(() => 1),
		};
		const footer = (footerFactory as FooterFactory)(tui, theme, footerData);
		const lines = footer.render(220);

		expect(lines[1]).toContain("worktree: repo-b");
		expect(lines[2]).toContain("↑1");
		expect(lines[2]).not.toContain("repo-a");
	});

	it("keeps the newer model footer active even when the prior session shares the same cwd", async () => {
		mockStat.mockResolvedValue(createDirectoryStats());

		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
		let footerFactory: unknown;
		const setFooter = vi.fn((factory: unknown) => {
			footerFactory = factory;
		});
		const pendingRev = createDeferred<ExecResult>();
		const pendingStatus = createDeferred<ExecResult>();
		const exec = vi.fn((command: string, args: string[]) => {
			if (command !== "git") throw new Error(`unexpected command: ${command}`);

			const workTreeIndex = args.indexOf("--work-tree");
			const workTree = workTreeIndex >= 0 ? args[workTreeIndex + 1] : undefined;
			if (workTree !== "/tmp/repo") {
				throw new Error(`unexpected worktree: ${workTree ?? "<missing>"}`);
			}

			return args.includes("rev-parse") ? pendingRev.promise : pendingStatus.promise;
		});
		const pi = {
			on: vi.fn((event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => {
				handlers.set(event, handler);
			}),
			exec,
		} as unknown as ExtensionAPI;

		customFooterExtension(pi);

		const ctxA = {
			cwd: "/tmp/repo",
			sessionManager: createSessionManager("session-a"),
			ui: {
				setFooter,
			},
			model: { id: "model-a" },
			getContextUsage: vi.fn(() => undefined),
		} as unknown as ExtensionContext;
		const ctxB = {
			cwd: "/tmp/repo",
			sessionManager: createSessionManager("session-b"),
			ui: {
				setFooter,
			},
			model: { id: "model-b" },
			getContextUsage: vi.fn(() => undefined),
		} as unknown as ExtensionContext;

		const startPromise = handlers.get("session_start")!({ type: "session_start", reason: "new" }, ctxA);
		const switchPromise = handlers.get("session_switch")!({ type: "session_switch", reason: "switch" }, ctxB);

		pendingRev.resolve({ stdout: "/tmp/repo", code: 0 });
		pendingStatus.resolve({ stdout: "## main...origin/main\n", code: 0 });

		await expect(Promise.all([startPromise, switchPromise])).resolves.toEqual([undefined, undefined]);
		expect(setFooter).toHaveBeenCalledTimes(1);

		const theme = {
			fg: (_tone: string, text: string) => text,
		};
		const tui = {
			requestRender: vi.fn(),
		};
		const footerData = {
			onBranchChange: vi.fn(() => vi.fn()),
			getGitBranch: vi.fn(() => "feature/test"),
			getExtensionStatuses: vi.fn(() => new Map()),
			getAvailableProviderCount: vi.fn(() => 1),
		};
		const footer = (footerFactory as FooterFactory)(tui, theme, footerData);
		const lines = footer.render(220);

		expect(lines[2]).toContain("model-b");
		expect(lines[2]).not.toContain("model-a");
	});
});
