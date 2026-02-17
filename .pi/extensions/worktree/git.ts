import { execFile } from "node:child_process";
import { makeToolError } from "./results";
import type { ToolError, WorktreeInfo } from "./types";

interface GitExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
}

export async function runGit(args: string[], cwd?: string): Promise<GitExecResult> {
	return new Promise((resolve) => {
		const child = execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				const code = "code" in error && typeof error.code === "number" ? error.code : 1;
				resolve({ ok: false, stdout: stdout ?? "", stderr: stderr ?? error.message, exitCode: code });
				return;
			}
			resolve({ ok: true, stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
		});

		// Handle spawn errors (e.g. git not found)
		child.on("error", (err: NodeJS.ErrnoException) => {
			resolve({ ok: false, stdout: "", stderr: err.message, exitCode: 127 });
		});
	});
}

/**
 * Check that git is available and version >= 2.7 (needed for `git worktree list --porcelain`).
 */
export async function checkGitVersion(): Promise<true | ToolError> {
	const result = await runGit(["--version"]);
	if (!result.ok) {
		return makeToolError("git is not installed or not available in PATH", "GIT_TOO_OLD");
	}

	// Output looks like: "git version 2.39.3 (Apple Git-146)"
	const match = result.stdout.match(/(\d+)\.(\d+)/);
	if (!match?.[1] || !match?.[2]) {
		return makeToolError(`Could not parse git version from: ${result.stdout.trim()}`, "GIT_TOO_OLD");
	}

	const major = parseInt(match[1], 10);
	const minor = parseInt(match[2], 10);

	if (major < 2 || (major === 2 && minor < 7)) {
		return makeToolError(`Git 2.7+ is required for worktree support, found ${major}.${minor}`, "GIT_TOO_OLD");
	}

	return true;
}

/**
 * Get the root directory of the current git repo.
 */
export async function getRepoRoot(cwd?: string): Promise<string | ToolError> {
	const result = await runGit(["rev-parse", "--show-toplevel"], cwd);
	if (!result.ok) {
		return makeToolError("Not inside a git repository", "NOT_A_GIT_REPO");
	}
	return result.stdout.trim();
}

/**
 * Get the repo name from the root directory path.
 */
export function getRepoName(repoRoot: string): string {
	const parts = repoRoot.split("/");
	return parts[parts.length - 1] ?? "repo";
}

/**
 * Sanitize a branch name for use in a directory name.
 * Replaces `/` with `-`, strips leading/trailing `-`.
 */
export function sanitizeBranchName(branch: string): string {
	return branch
		.replace(/\//g, "-")
		.replace(/[^a-zA-Z0-9_.-]/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
}

/**
 * Detect the default branch (main/master) using a fallback chain:
 * 1. git symbolic-ref refs/remotes/origin/HEAD
 * 2. git remote show origin (grep HEAD branch)
 * 3. Check if 'main' exists locally
 * 4. Check if 'master' exists locally
 */
export async function getDefaultBranch(cwd?: string): Promise<string | ToolError> {
	// Strategy 1: symbolic-ref
	const symref = await runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
	if (symref.ok) {
		const ref = symref.stdout.trim(); // e.g. "refs/remotes/origin/main"
		const branch = ref.replace("refs/remotes/origin/", "");
		if (branch) return branch;
	}

	// Strategy 2: remote show origin
	const remoteShow = await runGit(["remote", "show", "origin"], cwd);
	if (remoteShow.ok) {
		const match = remoteShow.stdout.match(/HEAD branch:\s*(.+)/);
		if (match?.[1]) return match[1].trim();
	}

	// Strategy 3: check if 'main' exists locally
	const mainCheck = await runGit(["rev-parse", "--verify", "main"], cwd);
	if (mainCheck.ok) return "main";

	// Strategy 4: check if 'master' exists locally
	const masterCheck = await runGit(["rev-parse", "--verify", "master"], cwd);
	if (masterCheck.ok) return "master";

	return makeToolError("Could not determine the default branch. No origin remote and neither 'main' nor 'master' exists locally.", "GIT_COMMAND_FAILED");
}

/**
 * Check if a branch exists locally.
 */
export async function branchExists(branch: string, cwd?: string): Promise<boolean> {
	const result = await runGit(["rev-parse", "--verify", branch], cwd);
	return result.ok;
}

/**
 * Check if a worktree directory has uncommitted changes.
 */
export async function isDirty(cwd: string): Promise<boolean> {
	const result = await runGit(["status", "--porcelain"], cwd);
	if (!result.ok) return false;
	return result.stdout.trim().length > 0;
}

/**
 * Count unpushed commits on the current branch compared to its upstream.
 * Returns 0 if no upstream is set.
 */
export async function unpushedCount(cwd: string): Promise<number> {
	const result = await runGit(["rev-list", "--count", "@{upstream}..HEAD"], cwd);
	if (!result.ok) return 0; // no upstream set
	const count = parseInt(result.stdout.trim(), 10);
	return isNaN(count) ? 0 : count;
}

/**
 * Parse `git worktree list --porcelain` output into structured data.
 */
export async function listWorktrees(cwd?: string): Promise<WorktreeInfo[] | ToolError> {
	const result = await runGit(["worktree", "list", "--porcelain"], cwd);
	if (!result.ok) {
		return makeToolError(`Failed to list worktrees: ${result.stderr}`, "GIT_COMMAND_FAILED");
	}

	const worktrees: WorktreeInfo[] = [];
	const blocks = result.stdout.split("\n\n");

	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (lines.length === 0) continue;

		let path: string | undefined;
		let branch: string | undefined;
		let isBare = false;

		for (const line of lines) {
			if (line.startsWith("worktree ")) {
				path = line.slice("worktree ".length);
			} else if (line.startsWith("branch ")) {
				// e.g. "branch refs/heads/main"
				branch = line.slice("branch ".length).replace("refs/heads/", "");
			} else if (line === "bare") {
				isBare = true;
			}
		}

		if (!path || isBare) continue;

		const isMain = worktrees.length === 0; // first entry is always the main worktree
		worktrees.push({
			path,
			branch,
			isMainWorktree: isMain,
			dirty: false, // filled in later by caller if needed
			unpushedCount: 0,
		});
	}

	return worktrees;
}

/**
 * Find a worktree by branch name.
 */
export function findWorktreeByBranch(worktrees: WorktreeInfo[], branch: string): WorktreeInfo | undefined {
	return worktrees.find((wt) => wt.branch === branch);
}
