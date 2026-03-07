import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	branchExists,
	checkGitVersion,
	findWorktreeByBranch,
	getCommonRepoRoot,
	getDefaultBranch,
	getRepoName,
	getRepoRoot,
	isDirty,
	listWorktrees,
	runGit,
	sanitizeBranchName,
	unpushedCount,
} from "./git.js";
import type { ToolError } from "./types.js";

const mockExecFile = vi.fn();

vi.mock("node:child_process", () => ({
	execFile: (...args: any[]) => mockExecFile(...args),
}));

function isToolError(value: unknown): value is ToolError {
	return !!value && typeof value === "object" && (value as Record<string, unknown>).ok === false;
}

describe("worktree git utilities", () => {
	beforeEach(() => {
		mockExecFile.mockReset();
	});

	it("gets repo name portably from paths", () => {
		expect(getRepoName("/tmp/repo")).toBe("repo");
		expect(getRepoName("C:\\Users\\me\\project")).toBe("project");
	});

	it("runGit resolves success output", async () => {
		mockExecFile.mockImplementation((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, "ok", "");
			return { on: vi.fn() };
		});

		const result = await runGit(["--version"]);
		expect(result.ok).toBe(true);
		expect(result.stdout).toBe("ok");
		expect(result.exitCode).toBe(0);
	});

	it("runGit resolves false output on callback error", async () => {
		mockExecFile.mockImplementation((...args: any[]) => {
			const cb: any = args.at(-1);
			const err = new Error("bad") as NodeJS.ErrnoException;
			err.code = "1";
			cb?.(err, "", "bad");
			return { on: vi.fn() };
		});
		const result = await runGit(["bad"]);
		expect(result.ok).toBe(false);
		expect(result.stderr).toBe("bad");
		expect(result.exitCode).toBe(1);
	});

	it("checkGitVersion validates minimum", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, "git version 2.6.0", "");
			return { on: vi.fn() };
		});
		const old = await checkGitVersion();
		expect(isToolError(old)).toBe(true);
		if (!isToolError(old)) return;
		expect(old.code).toBe("GIT_TOO_OLD");

		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, "git version 2.39.3", "");
			return { on: vi.fn() };
		});
		const good = await checkGitVersion();
		expect(good).toBe(true);
	});

	it("getRepoRoot maps git errors", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb: any = args.at(-1);
			const err = new Error("no") as NodeJS.ErrnoException;
			cb?.(err, "", "fatal");
			return { on: vi.fn() };
		});
		const bad = await getRepoRoot();
		expect(isToolError(bad)).toBe(true);

		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, "/tmp/repo\n", "");
			return { on: vi.fn() };
		});
		expect(await getRepoRoot()).toBe("/tmp/repo");
	});

	it("getCommonRepoRoot resolves shared root from common git dir", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, ".git\n", "");
			return { on: vi.fn() };
		});
		expect(await getCommonRepoRoot("/tmp/repo")).toBe("/tmp/repo");

		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, "/tmp/repo.git\n", "");
			return { on: vi.fn() };
		});
		expect(await getCommonRepoRoot()).toBe("/tmp/repo.git");
	});

	it("default branch detection falls back to local branches", async () => {
		mockExecFile
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				const err = new Error("no") as NodeJS.ErrnoException;
				cb?.(err, "", ""); // symbolic-ref fails
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				const err = new Error("no") as NodeJS.ErrnoException;
				cb?.(err, "", ""); // remote show fails
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(null, "commit\n", ""); // main exists
				return { on: vi.fn() };
			});

		expect(await getDefaultBranch()).toBe("main");
	});

	it("simple git state helpers parse output", async () => {
		mockExecFile
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(null, "main\n", "");
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(null, " M a.ts\n", "");
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(null, "2\n", "");
				return { on: vi.fn() };
			});

		expect(await branchExists("main")).toBe(true);
		expect(await isDirty("/tmp/worktree")).toBe(true);
		expect(await unpushedCount("/tmp/worktree")).toBe(2);
	});

	it("lists worktrees, filters bare entries, and marks main by common root", async () => {
		mockExecFile
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(null, "/tmp/main/.git\n", ""); // common git dir
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(
					null,
					"worktree /tmp/feature\nbranch refs/heads/feature\n\nworktree /tmp/main\nbranch refs/heads/main\n\nworktree /tmp/bare\nbare\n",
					"",
				);
				return { on: vi.fn() };
			});

		const result = await listWorktrees();
		if (isToolError(result)) throw new Error("unexpected tool error");
		expect(result).toHaveLength(2);
		expect(result[0]).toMatchObject({ path: "/tmp/feature", isMainWorktree: false });
		expect(result[1]).toMatchObject({ path: "/tmp/main", isMainWorktree: true });
	});

	it("sanitizes and finds branches", () => {
		expect(sanitizeBranchName("feat/new api")).toBe("feat-new-api");
		expect(
			findWorktreeByBranch(
				[
					{ path: "/tmp/a", branch: "a", isMainWorktree: true, dirty: false, unpushedCount: 0 },
					{ path: "/tmp/b", branch: "b", isMainWorktree: false, dirty: false, unpushedCount: 0 },
				],
				"b",
			),
		).toEqual({ path: "/tmp/b", branch: "b", isMainWorktree: false, dirty: false, unpushedCount: 0 });
	});
});
