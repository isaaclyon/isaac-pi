import { beforeEach, describe, expect, it, vi } from "vitest";

import * as deps from "./deps.js";
import * as configHelpers from "./config.js";
import * as git from "./git.js";
import { worktreeCreate } from "./create.js";

const mockAccess = vi.fn();
const mockMkdir = vi.fn();

vi.mock("node:fs/promises", () => ({
	access: (...args: any[]) => mockAccess(...args),
	constants: { F_OK: 0 },
	mkdir: (...args: any[]) => mockMkdir(...args),
}));

describe("worktree create", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("returns exists error when branch exists and not forced", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getRepoName").mockReturnValue("repo");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/repo/.worktrees/repo-main", branch: "main", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		const result = await worktreeCreate({ branch: "main" });
		expect(result).toEqual({
			ok: false,
			error: "A worktree already exists for branch 'main' at /tmp/repo/.worktrees/repo-main. Use force=true to return the existing path.",
			code: "WORKTREE_EXISTS",
		});
	});

	it("returns existing worktree when force is enabled", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getRepoName").mockReturnValue("repo");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/repo/.worktrees/repo-main", branch: "main", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue({
			manager: "pnpm",
			lockfile: "pnpm-lock.yaml",
			installCommand: ["pnpm", "install"],
		});

		const result = await worktreeCreate({ branch: "main", force: true });
		expect(result).toEqual({
			ok: true,
			path: "/tmp/repo/.worktrees/repo-main",
			branch: "main",
			created: false,
			packageManager: "pnpm",
			configFilesCopied: [],
			gitignoreModified: false,
			direnvAllowRan: false,
			direnvAllowSuccess: true,
		});
	});

	it("creates a new worktree branch successfully", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getRepoName").mockReturnValue("repo");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([]);
		vi.spyOn(git, "branchExists").mockResolvedValue(false);
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		vi.spyOn(configHelpers, "ensureGitignoreEntry").mockResolvedValue(true);
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy.mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 });
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue(undefined);
		vi.spyOn(deps, "installDeps").mockResolvedValue(true);
		vi.spyOn(configHelpers, "copyAllConfigFiles").mockResolvedValue([".env"]);
		mockAccess.mockRejectedValue(Object.assign(new Error("no envrc"), { code: "ENOENT" }));
		mockMkdir.mockResolvedValue(undefined);

		const result = await worktreeCreate({ branch: "feat" });
		expect(runGitSpy).toHaveBeenCalledWith(
			["worktree", "add", "-b", "feat", "/tmp/repo/.worktrees/repo-feat", "main"],
			"/tmp/repo",
		);
		expect(result).toEqual({
			ok: true,
			path: "/tmp/repo/.worktrees/repo-feat",
			branch: "feat",
			created: true,
			packageManager: undefined,
			configFilesCopied: [".env"],
			gitignoreModified: true,
			direnvAllowRan: false,
			direnvAllowSuccess: true,
		});
	});

	it("returns git command failure as tool error", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getRepoName").mockReturnValue("repo");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([]);
		vi.spyOn(git, "branchExists").mockResolvedValue(false);
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		vi.spyOn(configHelpers, "ensureGitignoreEntry").mockResolvedValue(false);
		vi.spyOn(git, "runGit").mockResolvedValue({
			ok: false,
			stdout: "",
			stderr: "bad",
			exitCode: 1,
		});
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue(undefined);
		mockMkdir.mockResolvedValue(undefined);

		const result = await worktreeCreate({ branch: "bad" });
		expect(result).toEqual({
			ok: false,
			error: "Failed to create worktree: bad",
			code: "GIT_COMMAND_FAILED",
		});
	});
});
