import {
	checkGitVersion,
	getRepoRoot,
	getDefaultBranch,
	listWorktrees,
	findWorktreeByBranch,
	runGit,
} from "./git";
import { detectPackageManager, installDeps } from "./deps";
import { makeToolError, isToolError } from "./results";
import type { SyncWorktreeResult, ToolError } from "./types";

export interface SyncParams {
	branch?: string;
}

interface SyncOutput {
	ok: true;
	defaultBranch: string;
	results: SyncWorktreeResult[];
}

/**
 * Sync one or all worktrees:
 * 1. Pull the default branch in the main repo
 * 2. Rebase each worktree branch onto the updated default
 * 3. Re-install deps in each worktree
 */
export async function worktreeSync(params: SyncParams): Promise<SyncOutput | ToolError> {
	// 1. Preflight
	const gitCheck = await checkGitVersion();
	if (gitCheck !== true) return gitCheck;

	const repoRoot = await getRepoRoot();
	if (isToolError(repoRoot)) return repoRoot;

	const defaultBranch = await getDefaultBranch(repoRoot);
	if (isToolError(defaultBranch)) return defaultBranch;

	// 2. Pull the default branch in the main repo
	const pullResult = await runGit(["pull", "origin", defaultBranch], repoRoot);
	if (!pullResult.ok) {
		return makeToolError(`Failed to pull ${defaultBranch}: ${pullResult.stderr}`, "GIT_COMMAND_FAILED");
	}

	// 3. Get worktrees
	const worktrees = await listWorktrees(repoRoot);
	if (isToolError(worktrees)) return worktrees;

	// Filter to non-main worktrees with branches
	let targets = worktrees.filter((wt) => !wt.isMainWorktree && wt.branch);

	// If a specific branch was requested, filter to just that one
	if (params.branch) {
		const match = findWorktreeByBranch(worktrees, params.branch);
		if (!match) {
			return makeToolError(`No worktree found for branch '${params.branch}'`, "WORKTREE_NOT_FOUND");
		}
		if (match.isMainWorktree) {
			return makeToolError("Cannot sync the main worktree — it was already pulled", "INVALID_ARGUMENT");
		}
		targets = [match];
	}

	if (targets.length === 0) {
		return { ok: true, defaultBranch, results: [] };
	}

	// 4. Rebase and reinstall deps for each target
	const pm = await detectPackageManager(repoRoot);
	const results: SyncWorktreeResult[] = [];

	for (const wt of targets) {
		const branch = wt.branch!; // filtered above
		const result = await syncSingleWorktree(wt.path, branch, defaultBranch, repoRoot, pm);
		results.push(result);
	}

	return { ok: true, defaultBranch, results };
}

async function syncSingleWorktree(
	worktreePath: string,
	branch: string,
	defaultBranch: string,
	repoRoot: string,
	pm: Awaited<ReturnType<typeof detectPackageManager>>,
): Promise<SyncWorktreeResult> {
	// Rebase onto the default branch
	const rebaseResult = await runGit(["rebase", defaultBranch], worktreePath);

	if (!rebaseResult.ok) {
		// Check if it's a conflict
		const isConflict =
			rebaseResult.stderr.includes("CONFLICT") ||
			rebaseResult.stderr.includes("could not apply") ||
			rebaseResult.stdout.includes("CONFLICT");

		if (isConflict) {
			// Get list of conflicting files
			const diffResult = await runGit(["diff", "--name-only", "--diff-filter=U"], worktreePath);
			const conflicts = diffResult.ok
				? diffResult.stdout.trim().split("\n").filter(Boolean)
				: [];

			// Abort the rebase
			await runGit(["rebase", "--abort"], worktreePath);

			return {
				branch,
				path: worktreePath,
				ok: false,
				error: `Rebase conflict on ${branch}. Rebase was aborted.`,
				conflicts,
				depsReinstalled: false,
			};
		}

		// Some other rebase failure
		return {
			branch,
			path: worktreePath,
			ok: false,
			error: `Rebase failed: ${rebaseResult.stderr.trim()}`,
			depsReinstalled: false,
		};
	}

	// Re-install deps
	let depsReinstalled = false;
	if (pm) {
		const installResult = await installDeps(worktreePath, pm);
		depsReinstalled = installResult === true;
	}

	return {
		branch,
		path: worktreePath,
		ok: true,
		depsReinstalled,
	};
}
