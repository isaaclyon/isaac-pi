import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	branchExists,
	checkGitVersion,
	findWorktreeByBranch,
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
			err.code = "1";
			cb?.(err, "", "no");
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

	it("parses repo name and sanitizes branch names", () => {
		expect(getRepoName("/tmp/my-repo")).toBe("my-repo");
		expect(sanitizeBranchName("feature/test/branch")).toBe("feature-test-branch");
		expect(sanitizeBranchName("feat//bad///")).toBe("feat-bad");
	});

	it("gets default branch through fallback steps", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, "refs/remotes/origin/main", "");
			return { on: vi.fn() };
		});
		expect(await getDefaultBranch()).toBe("main");

		mockExecFile
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				const err = new Error("no") as NodeJS.ErrnoException;
				err.code = "1";
				cb?.(err, "", "no");
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				const err = new Error("no") as NodeJS.ErrnoException;
				err.code = "1";
				cb?.(err, "", "no");
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(null, "heads/main", "");
				return { on: vi.fn() };
			});
		expect(await getDefaultBranch()).toBe("main");

		mockExecFile
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				const err = new Error("no") as NodeJS.ErrnoException;
				err.code = "1";
				cb?.(err, "", "no");
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				const err = new Error("no") as NodeJS.ErrnoException;
				err.code = "1";
				cb?.(err, "", "no");
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				const err = new Error("no") as NodeJS.ErrnoException;
				err.code = "1";
				cb?.(err, "", "no");
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				const err = new Error("no") as NodeJS.ErrnoException;
				err.code = "1";
				cb?.(err, "", "no");
				return { on: vi.fn() };
			});
		const missing = await getDefaultBranch();
		expect(isToolError(missing)).toBe(true);
	});

	it("checks branch existence, dirty state, and unpushed count", async () => {
		mockExecFile
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(null, "refs", "");
				return { on: vi.fn() };
			})
			.mockImplementationOnce((...args: any[]) => {
				const cb: any = args.at(-1);
				cb?.(null, "M file\n", "");
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

	it("lists worktrees and filters bare entries", async () => {
		mockExecFile.mockImplementationOnce((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(
				null,
				"worktree /tmp/main\nbranch refs/heads/main\n\nworktree /tmp/feature\nbranch refs/heads/feature\n",
				"",
			);
			return { on: vi.fn() };
		});

		const result = await listWorktrees();
		if (isToolError(result)) {
			throw new Error("unexpected tool error");
		}
		expect(result).toHaveLength(2);
		expect(result[0].path).toBe("/tmp/main");
		expect(result[0].isMainWorktree).toBe(true);
		expect(result[1].path).toBe("/tmp/feature");
	});

	it("finds worktree by branch", () => {
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
