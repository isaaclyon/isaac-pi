import { afterEach, describe, expect, it, vi } from "vitest";

import * as deps from "./deps.js";
import * as git from "./git.js";
import { worktreeSync } from "./sync.js";

describe("worktree sync", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns early on preflight failures", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue({ ok: false, error: "bad", code: "GIT_TOO_OLD" });
		const result = await worktreeSync({});
		expect(result).toEqual({ ok: false, error: "bad", code: "GIT_TOO_OLD" });
	});

	it("returns empty result when no non-main targets", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		vi.spyOn(git, "runGit").mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 });
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
		]);

		const result = await worktreeSync({});
		expect(result).toEqual({ ok: true, defaultBranch: "main", results: [] });
	});

	it("syncs all non-main worktrees and installs deps", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }) // pull
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 });
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feat", branch: "feat", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue({
			manager: "npm",
			lockfile: "package-lock.json",
			installCommand: ["npm", "ci"],
		});
		vi.spyOn(deps, "installDeps").mockResolvedValue(true);

		const result = await worktreeSync({});
		expect(result.ok).toBe(true);
		expect(result.defaultBranch).toBe("main");
		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toEqual({ branch: "feat", path: "/tmp/feat", ok: true, depsReinstalled: true });
	});

	it("syncs a specific branch", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy.mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 });
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feature", branch: "feature", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue(undefined);
		vi.spyOn(deps, "installDeps").mockResolvedValue(true);
		const result = await worktreeSync({ branch: "feature" });
		expect(runGitSpy).toHaveBeenCalledWith(["rebase", "main"], "/tmp/feature");
		expect(result.results[0]?.branch).toBe("feature");
	});

	it("rejects unknown branch names", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		vi.spyOn(git, "runGit").mockResolvedValue({ ok: true, stdout: "", stderr: "", exitCode: 0 });
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
		]);
		const result = await worktreeSync({ branch: "missing" });
		expect(result).toEqual({ ok: false, error: "No worktree found for branch 'missing'", code: "WORKTREE_NOT_FOUND" });
	});

	it("errors on pulling failure", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		vi.spyOn(git, "runGit").mockResolvedValue({ ok: false, stdout: "", stderr: "network", exitCode: 1 });
		vi.spyOn(git, "listWorktrees").mockResolvedValue([]);
		const result = await worktreeSync({});
		expect(result).toEqual({ ok: false, error: "Failed to pull main: network", code: "GIT_COMMAND_FAILED" });
	});

	it("reports rebase conflict and aborts", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "CONFLICT: conflict", exitCode: 1 })
			.mockResolvedValueOnce({ ok: true, stdout: "a\nb", stderr: "", exitCode: 0 })
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 });
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feature", branch: "feature", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue(undefined);

		const result = await worktreeSync({});
		expect(result.ok).toBe(true);
		expect(result.results[0].ok).toBe(false);
		expect(result.results[0].error).toContain("Rebase conflict on feature");
		expect(result.results[0].conflicts).toEqual(["a", "b"]);
	});
});
