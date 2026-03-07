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
	upstreamRef: string;
	fetched: boolean;
	results: SyncWorktreeResult[];
}

export async function worktreeSync(params: SyncParams): Promise<SyncOutput | ToolError> {
	const gitCheck = await checkGitVersion();
	if (gitCheck !== true) return gitCheck;

	const repoRoot = await getRepoRoot();
	if (isToolError(repoRoot)) return repoRoot;

	const defaultBranch = await getDefaultBranch(repoRoot);
	if (isToolError(defaultBranch)) return defaultBranch;

	const worktrees = await listWorktrees(repoRoot);
	if (isToolError(worktrees)) return worktrees;

	let targets = worktrees.filter((wt) => !wt.isMainWorktree && wt.branch);

	if (params.branch) {
		const match = findWorktreeByBranch(worktrees, params.branch);
		if (!match) {
			return makeToolError(`No worktree found for branch '${params.branch}'`, "WORKTREE_NOT_FOUND");
		}
		if (match.isMainWorktree) {
			return makeToolError("Cannot sync the main worktree — base branch was already updated", "INVALID_ARGUMENT");
		}
		targets = [match];
	}

	if (targets.length === 0) {
		return { ok: true, defaultBranch, upstreamRef: defaultBranch, fetched: false, results: [] };
	}

	const remotesResult = await runGit(["remote"], repoRoot);
	if (!remotesResult.ok) {
		const remoteErrorText = `${remotesResult.stderr}\n${remotesResult.stdout}`.trim();
		return makeToolError(
			`Failed to inspect git remotes: ${remoteErrorText || "unknown error"}`,
			"GIT_COMMAND_FAILED",
		);
	}

	const remotes = remotesResult.stdout
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean);
	const hasOriginRemote = remotes.includes("origin");

	let upstreamRef = defaultBranch;
	let fetched = false;

	if (hasOriginRemote) {
		const fetchResult = await runGit(["fetch", "origin", defaultBranch], repoRoot);
		if (!fetchResult.ok) {
			return makeToolError(`Failed to fetch origin/${defaultBranch}: ${fetchResult.stderr}`, "GIT_COMMAND_FAILED");
		}
		upstreamRef = `origin/${defaultBranch}`;
		fetched = true;
	}

	const pm = await detectPackageManager(repoRoot);
	const results: SyncWorktreeResult[] = [];

	for (const wt of targets) {
		const branch = wt.branch!; // filtered above
		const result = await syncSingleWorktree(wt.path, branch, upstreamRef, pm);
		results.push(result);
	}

	return { ok: true, defaultBranch, upstreamRef, fetched, results };
}

async function syncSingleWorktree(
	worktreePath: string,
	branch: string,
	upstreamRef: string,
	pm: Awaited<ReturnType<typeof detectPackageManager>>,
): Promise<SyncWorktreeResult> {
	const rebaseResult = await runGit(["rebase", upstreamRef], worktreePath);

	if (!rebaseResult.ok) {
		const isConflict =
			rebaseResult.stderr.includes("CONFLICT") ||
			rebaseResult.stderr.includes("could not apply") ||
			rebaseResult.stdout.includes("CONFLICT");

		if (isConflict) {
			const diffResult = await runGit(["diff", "--name-only", "--diff-filter=U"], worktreePath);
			const conflicts = diffResult.ok
				? diffResult.stdout.trim().split("\n").filter(Boolean)
				: [];

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

		return {
			branch,
			path: worktreePath,
			ok: false,
			error: `Rebase failed: ${(rebaseResult.stderr || rebaseResult.stdout).trim() || "unknown error"}`,
			depsReinstalled: false,
		};
	}

	let depsReinstalled = false;
	let depsInstallError: string | undefined;
	if (pm) {
		const installResult = await installDeps(worktreePath, pm);
		if (installResult === true) {
			depsReinstalled = true;
		} else {
			depsInstallError = installResult.error;
		}
	}

	return {
		branch,
		path: worktreePath,
		ok: true,
		depsReinstalled,
		...(depsInstallError ? { depsInstallError } : {}),
	};
}
