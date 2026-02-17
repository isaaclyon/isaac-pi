import {
	checkGitVersion,
	getRepoRoot,
	listWorktrees,
	isDirty,
	unpushedCount,
} from "./git";
import { isToolError } from "./results";
import type { WorktreeInfo, ToolError } from "./types";

export async function worktreeList(): Promise<WorktreeInfo[] | ToolError> {
	// 1. Preflight checks
	const gitCheck = await checkGitVersion();
	if (gitCheck !== true) return gitCheck;

	const repoRoot = await getRepoRoot();
	if (isToolError(repoRoot)) return repoRoot;

	// 2. Get worktrees
	const worktrees = await listWorktrees(repoRoot);
	if (isToolError(worktrees)) return worktrees;

	// 3. Enrich each worktree with dirty status and unpushed count
	for (const wt of worktrees) {
		wt.dirty = await isDirty(wt.path);
		wt.unpushedCount = await unpushedCount(wt.path);
	}

	return worktrees;
}

/**
 * Format worktree list as readable text for the tool result.
 */
export function formatWorktreeList(worktrees: WorktreeInfo[]): string {
	if (worktrees.length === 0) {
		return "No worktrees found.";
	}

	const lines: string[] = [];
	for (const wt of worktrees) {
		const branch = wt.branch ?? "(detached HEAD)";
		const status = wt.dirty ? "dirty" : "clean";
		const unpushed = wt.unpushedCount > 0 ? `, ${wt.unpushedCount} unpushed` : "";
		const main = wt.isMainWorktree ? " (main)" : "";
		lines.push(`${branch}${main}: ${wt.path} [${status}${unpushed}]`);
	}

	return lines.join("\n");
}
