import {
	checkGitVersion,
	getRepoRoot,
	listWorktrees,
	findWorktreeByBranch,
	isDirty,
	unpushedCount,
	runGit,
} from "./git";
import { makeToolError, isToolError } from "./results";
import type { RemoveResult, ToolError } from "./types";

export interface RemoveParams {
	branch: string;
	deleteBranch?: boolean;
	force?: boolean;
}

export async function worktreeRemove(params: RemoveParams): Promise<RemoveResult | ToolError> {
	// 1. Preflight checks
	const gitCheck = await checkGitVersion();
	if (gitCheck !== true) return gitCheck;

	const repoRoot = await getRepoRoot();
	if (isToolError(repoRoot)) return repoRoot;

	// 2. Find the worktree by branch
	const worktrees = await listWorktrees(repoRoot);
	if (isToolError(worktrees)) return worktrees;

	const worktree = findWorktreeByBranch(worktrees, params.branch);
	if (!worktree) {
		return makeToolError(`No worktree found for branch '${params.branch}'`, "WORKTREE_NOT_FOUND");
	}

	if (worktree.isMainWorktree) {
		return makeToolError("Cannot remove the main worktree", "REMOVE_FAILED");
	}

	const warnings: string[] = [];

	// 3. Safety checks (unless force)
	if (!params.force) {
		// Check for uncommitted changes
		const dirty = await isDirty(worktree.path);
		if (dirty) {
			return makeToolError(
				`Worktree at ${worktree.path} has uncommitted changes. Use force=true to remove anyway.`,
				"DIRTY_WORKTREE",
			);
		}

		// Warn about unpushed commits (but still proceed)
		const count = await unpushedCount(worktree.path);
		if (count > 0) {
			warnings.push(`Branch '${params.branch}' has ${count} unpushed commit${count === 1 ? "" : "s"}`);
		}
	}

	// 4. Remove the worktree
	const removeArgs = ["worktree", "remove", worktree.path];
	if (params.force) removeArgs.push("--force");

	const removeResult = await runGit(removeArgs, repoRoot);
	if (!removeResult.ok) {
		return makeToolError(`Failed to remove worktree: ${removeResult.stderr}`, "REMOVE_FAILED");
	}

	// 5. Prune worktree metadata
	await runGit(["worktree", "prune"], repoRoot);

	// 6. Optionally delete the branch
	let branchDeleted = false;
	if (params.deleteBranch) {
		const deleteFlag = params.force ? "-D" : "-d";
		const branchResult = await runGit(["branch", deleteFlag, params.branch], repoRoot);
		if (branchResult.ok) {
			branchDeleted = true;
		} else {
			warnings.push(`Could not delete branch '${params.branch}': ${branchResult.stderr.trim()}`);
		}
	}

	return {
		ok: true,
		path: worktree.path,
		branch: params.branch,
		branchDeleted,
		warnings,
	};
}
