import { afterEach, describe, expect, it, vi } from "vitest";

import * as deps from "./deps.js";
import * as git from "./git.js";
import { worktreeSync } from "./sync.js";

type WorktreeSyncResult = Awaited<ReturnType<typeof worktreeSync>>;
type WorktreeSyncSuccess = Extract<WorktreeSyncResult, { ok: true }>;

function expectSyncSuccess(result: WorktreeSyncResult): asserts result is WorktreeSyncSuccess {
	expect(result.ok).toBe(true);
	if (!result.ok) {
		throw new Error(`Expected sync success, got error: ${result.error}`);
	}
}

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
		const runGitSpy = vi.spyOn(git, "runGit");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
		]);

		const result = await worktreeSync({});
		expect(result).toEqual({
			ok: true,
			defaultBranch: "main",
			upstreamRef: "main",
			fetched: false,
			results: [],
		});
		expect(runGitSpy).not.toHaveBeenCalled();
	});

	it("errors when git remotes inspection fails unexpectedly", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feature", branch: "feature", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(git, "runGit").mockResolvedValueOnce({ ok: false, stdout: "", stderr: "permission denied", exitCode: 1 });

		const result = await worktreeSync({});
		expect(result).toEqual({
			ok: false,
			error: "Failed to inspect git remotes: permission denied",
			code: "GIT_COMMAND_FAILED",
		});
	});

	it("falls back to local default branch when origin remote is missing", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy
			.mockResolvedValueOnce({ ok: true, stdout: "upstream\n", stderr: "", exitCode: 0 }) // git remote
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }); // rebase main
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feat", branch: "feat", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue(undefined);

		const result = await worktreeSync({});
		expectSyncSuccess(result);
		expect(result.upstreamRef).toBe("main");
		expect(result.fetched).toBe(false);
		expect(runGitSpy).toHaveBeenCalledWith(["rebase", "main"], "/tmp/feat");
	});

	it("syncs all non-main worktrees and installs deps", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy
			.mockResolvedValueOnce({ ok: true, stdout: "origin\n", stderr: "", exitCode: 0 }) // git remote
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }) // fetch
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }); // rebase
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
		expectSyncSuccess(result);
		expect(result.defaultBranch).toBe("main");
		expect(result.upstreamRef).toBe("origin/main");
		expect(result.fetched).toBe(true);
		expect(result.results).toHaveLength(1);
		expect(result.results[0]).toEqual({ branch: "feat", path: "/tmp/feat", ok: true, depsReinstalled: true });
	});

	it("syncs a specific branch", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy
			.mockResolvedValueOnce({ ok: true, stdout: "origin\n", stderr: "", exitCode: 0 }) // git remote
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }) // fetch
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }); // rebase
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feature", branch: "feature", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue(undefined);
		vi.spyOn(deps, "installDeps").mockResolvedValue(true);
		const result = await worktreeSync({ branch: "feature" });
		expectSyncSuccess(result);
		expect(runGitSpy).toHaveBeenCalledWith(["rebase", "origin/main"], "/tmp/feature");
		expect(result.results[0]?.branch).toBe("feature");
	});

	it("surfaces dependency reinstall failures in sync results", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy
			.mockResolvedValueOnce({ ok: true, stdout: "origin\n", stderr: "", exitCode: 0 }) // git remote
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }) // fetch
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }); // rebase
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feature", branch: "feature", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue({
			manager: "npm",
			lockfile: "package-lock.json",
			installCommand: ["npm", "ci"],
		});
		vi.spyOn(deps, "installDeps").mockResolvedValue({
			ok: false,
			error: "npm install failed",
			code: "DEP_INSTALL_FAILED",
		});

		const result = await worktreeSync({});
		expectSyncSuccess(result);
		expect(result.results[0]).toEqual({
			branch: "feature",
			path: "/tmp/feature",
			ok: true,
			depsReinstalled: false,
			depsInstallError: "npm install failed",
		});
	});

	it("rejects unknown branch names without hitting remotes", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
		]);
		const result = await worktreeSync({ branch: "missing" });
		expect(result).toEqual({ ok: false, error: "No worktree found for branch 'missing'", code: "WORKTREE_NOT_FOUND" });
		expect(runGitSpy).not.toHaveBeenCalled();
	});

	it("errors on fetch failure", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy
			.mockResolvedValueOnce({ ok: true, stdout: "origin\n", stderr: "", exitCode: 0 }) // git remote
			.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "network", exitCode: 1 }); // fetch
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feature", branch: "feature", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		const result = await worktreeSync({});
		expect(result).toEqual({ ok: false, error: "Failed to fetch origin/main: network", code: "GIT_COMMAND_FAILED" });
	});

	it("reports rebase conflict and aborts", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "getDefaultBranch").mockResolvedValue("main");
		const runGitSpy = vi.spyOn(git, "runGit");
		runGitSpy
			.mockResolvedValueOnce({ ok: true, stdout: "origin\n", stderr: "", exitCode: 0 }) // git remote
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }) // fetch
			.mockResolvedValueOnce({ ok: false, stdout: "", stderr: "CONFLICT: conflict", exitCode: 1 }) // rebase
			.mockResolvedValueOnce({ ok: true, stdout: "a\nb", stderr: "", exitCode: 0 }) // diff
			.mockResolvedValueOnce({ ok: true, stdout: "", stderr: "", exitCode: 0 }); // rebase --abort
		vi.spyOn(git, "listWorktrees").mockResolvedValue([
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feature", branch: "feature", isMainWorktree: false, dirty: false, unpushedCount: 0 },
		]);
		vi.spyOn(deps, "detectPackageManager").mockResolvedValue(undefined);

		const result = await worktreeSync({});
		expectSyncSuccess(result);
		expect(result.results[0].ok).toBe(false);
		expect(result.results[0].error).toContain("Rebase conflict on feature");
		expect(result.results[0].conflicts).toEqual(["a", "b"]);
	});
});
