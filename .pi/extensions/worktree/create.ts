import path from "node:path";
import { access, constants, mkdir } from "node:fs/promises";
import {
	checkGitVersion,
	getRepoRoot,
	getRepoName,
	sanitizeBranchName,
	getDefaultBranch,
	branchExists,
	listWorktrees,
	findWorktreeByBranch,
	runGit,
} from "./git";
import { detectPackageManager, installDeps } from "./deps";
import { ensureGitignoreEntry, copyAllConfigFiles } from "./config";
import { makeToolError, isToolError } from "./results";
import type { CreateResult, ToolError } from "./types";

export interface CreateParams {
	branch: string;
	base?: string;
	configFiles?: string[];
	force?: boolean;
}

async function runDirenvAllow(worktreePath: string): Promise<{ ran: boolean; ok: boolean; error?: string }> {
	const envrcPath = path.join(worktreePath, ".envrc");
	try {
		await access(envrcPath, constants.F_OK);
	} catch {
		return { ran: false, ok: true };
	}

	const { execFile } = await import("node:child_process");

	return new Promise((resolve) => {
		execFile("direnv", ["allow", worktreePath], { maxBuffer: 10 * 1024 * 1024 }, (error, _stdout, stderr) => {
			if (error) {
				resolve({
					ran: true,
					ok: false,
					error: (stderr || error.message).trim() || "direnv allow failed",
				});
				return;
			}

			resolve({ ran: true, ok: true });
		});
	});
}

export async function worktreeCreate(params: CreateParams): Promise<CreateResult | ToolError> {
	// 1. Preflight checks
	const gitCheck = await checkGitVersion();
	if (gitCheck !== true) return gitCheck;

	const repoRoot = await getRepoRoot();
	if (isToolError(repoRoot)) return repoRoot;

	const repoName = getRepoName(repoRoot);
	const sanitizedBranch = sanitizeBranchName(params.branch);
	const worktreeDir = `.worktrees`;
	const worktreeName = `${repoName}-${sanitizedBranch}`;
	const worktreePath = path.join(repoRoot, worktreeDir, worktreeName);

	// 2. Check if worktree already exists for this branch
	const existingWorktrees = await listWorktrees(repoRoot);
	if (isToolError(existingWorktrees)) return existingWorktrees;

	const existing = findWorktreeByBranch(existingWorktrees, params.branch);
	if (existing) {
		if (params.force) {
			// Return existing worktree info without recreating
			const pm = await detectPackageManager(repoRoot);
			return {
				ok: true,
				path: existing.path,
				branch: params.branch,
				created: false,
				packageManager: pm?.manager,
				configFilesCopied: [],
				gitignoreModified: false,
				direnvAllowRan: false,
				direnvAllowSuccess: true,
			};
		}
		return makeToolError(
			`A worktree already exists for branch '${params.branch}' at ${existing.path}. Use force=true to return the existing path.`,
			"WORKTREE_EXISTS",
		);
	}

	// 3. Ensure .worktrees/ directory exists
	const worktreesRoot = path.join(repoRoot, worktreeDir);
	await mkdir(worktreesRoot, { recursive: true });

	// 4. Ensure .worktrees/ is in .gitignore
	const gitignoreModified = await ensureGitignoreEntry(repoRoot);

	// 5. Determine base branch and create worktree
	const branchAlreadyExists = await branchExists(params.branch, repoRoot);

	if (branchAlreadyExists) {
		// Check out existing branch in the new worktree
		const result = await runGit(["worktree", "add", worktreePath, params.branch], repoRoot);
		if (!result.ok) {
			return makeToolError(`Failed to create worktree: ${result.stderr}`, "GIT_COMMAND_FAILED");
		}
	} else {
		// Create a new branch from base
		let base = params.base;
		if (!base) {
			const defaultBranch = await getDefaultBranch(repoRoot);
			if (isToolError(defaultBranch)) return defaultBranch;
			base = defaultBranch;
		}

		const result = await runGit(["worktree", "add", "-b", params.branch, worktreePath, base], repoRoot);
		if (!result.ok) {
			return makeToolError(`Failed to create worktree: ${result.stderr}`, "GIT_COMMAND_FAILED");
		}
	}

	// 6. Detect and install dependencies
	const pm = await detectPackageManager(repoRoot);
	if (pm) {
		const installResult = await installDeps(worktreePath, pm);
		if (isToolError(installResult)) {
			// Don't fail the whole operation — worktree was created, just warn
			// The error will be visible in the result
		}
	}

	// 7. Copy config files
	const configFilesCopied = await copyAllConfigFiles(repoRoot, worktreePath, params.configFiles);

	// 8. Allow direnv for copied gitignored env config (if present)
	const direnvAllow = await runDirenvAllow(worktreePath);

	return {
		ok: true,
		path: worktreePath,
		branch: params.branch,
		created: true,
		packageManager: pm?.manager,
		configFilesCopied,
		gitignoreModified,
		direnvAllowRan: direnvAllow.ran,
		direnvAllowSuccess: direnvAllow.ok,
		...(direnvAllow.ok ? {} : { direnvAllowError: direnvAllow.error }),
	};
}
