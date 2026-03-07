import { afterEach, describe, expect, it, vi } from "vitest";

import * as git from "./git.js";
import { worktreeRemove } from "./remove.js";

describe("worktree remove", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("removes branch and returns result", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/feat", branch: "feat", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(git, "findWorktreeByBranch").mockReturnValue({ path: "/tmp/feat", branch: "feat", isMainWorktree: false, dirty: false, unpushedCount: 0 });
		vi.spyOn(git, "isDirty").mockResolvedValue(false);
		vi.spyOn(git, "unpushedCount").mockResolvedValue(0);
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 });
		runGitSpy.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 });

		const result = await worktreeRemove({ branch: "feat" });
		expect(runGitSpy).toHaveBeenCalledWith(["worktree", "remove", "/tmp/feat"], "/tmp/repo");
		expect(result).toEqual({
			ok: true,
			path: "/tmp/feat",
			branch: "feat",
			branchDeleted: false,
			warnings: [],
		});
	});

	it("supports force deletion and branch deletion", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/feat", branch: "feat", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(git, "findWorktreeByBranch").mockReturnValue({ path: "/tmp/feat", branch: "feat", isMainWorktree: false, dirty: false, unpushedCount: 0 });
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy.mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 });

		const result = await worktreeRemove({ branch: "feat", force: true, deleteBranch: true });
		expect(runGitSpy).toHaveBeenCalledWith(["worktree", "remove", "/tmp/feat", "--force"], "/tmp/repo");
		expect(runGitSpy).toHaveBeenCalledWith(["branch", "-D", "feat"], "/tmp/repo");
		expect(result).toEqual({
			ok: true,
			path: "/tmp/feat",
			branch: "feat",
			branchDeleted: true,
			warnings: [],
		});
	});

	it("disallows removing main worktree", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(git, "findWorktreeByBranch").mockReturnValue({ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 });
		const result = await worktreeRemove({ branch: "main" });
		expect(result).toEqual({
			ok: false,
			error: "Cannot remove the main worktree",
			code: "REMOVE_FAILED",
		});
	});
});
