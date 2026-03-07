import { execFile } from "node:child_process";
import path from "node:path";
import { isToolError, makeToolError } from "./results";
import type { ToolError, WorktreeInfo } from "./types";

interface GitExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
}

export async function runGit(args: string[], cwd?: string): Promise<GitExecResult> {
	return new Promise((resolve) => {
		let settled = false;
		const finish = (result: GitExecResult) => {
			if (settled) return;
			settled = true;
			resolve(result);
		};

		const child = execFile("git", args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
			if (error) {
				const rawCode = "code" in error ? error.code : undefined;
				const exitCode =
					typeof rawCode === "number"
						? rawCode
						: typeof rawCode === "string" && /^\d+$/.test(rawCode)
							? parseInt(rawCode, 10)
							: 1;
				finish({ ok: false, stdout: stdout ?? "", stderr: stderr ?? error.message, exitCode });
				return;
			}
			finish({ ok: true, stdout: stdout ?? "", stderr: stderr ?? "", exitCode: 0 });
		});

		child.on("error", (err: NodeJS.ErrnoException) => {
			finish({ ok: false, stdout: "", stderr: err.message, exitCode: 127 });
		});
	});
}

export async function checkGitVersion(): Promise<true | ToolError> {
	const result = await runGit(["--version"]);
	if (!result.ok) {
		return makeToolError("git is not installed or not available in PATH", "GIT_TOO_OLD");
	}

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

export async function getRepoRoot(cwd?: string): Promise<string | ToolError> {
	const result = await runGit(["rev-parse", "--show-toplevel"], cwd);
	if (!result.ok) {
		return makeToolError("Not inside a git repository", "NOT_A_GIT_REPO");
	}
	return result.stdout.trim();
}

export async function getCommonRepoRoot(cwd?: string): Promise<string | ToolError> {
	const result = await runGit(["rev-parse", "--git-common-dir"], cwd);
	if (!result.ok) {
		return makeToolError("Could not determine shared git directory", "GIT_COMMAND_FAILED");
	}

	const commonDirRaw = result.stdout.trim();
	if (!commonDirRaw) {
		return makeToolError("Could not determine shared git directory", "GIT_COMMAND_FAILED");
	}

	const baseDir = cwd ? path.resolve(cwd) : process.cwd();
	const commonDir = path.isAbsolute(commonDirRaw)
		? commonDirRaw
		: path.resolve(baseDir, commonDirRaw);

	return /[\\/]\.git$/.test(commonDir) ? path.dirname(commonDir) : commonDir;
}

export function getRepoName(repoRoot: string): string {
	const posixName = path.basename(repoRoot);
	if (posixName && posixName !== repoRoot) return posixName;
	return path.win32.basename(repoRoot) || posixName || "repo";
}

export function sanitizeBranchName(branch: string): string {
	return branch
		.replace(/\//g, "-")
		.replace(/[^a-zA-Z0-9_.-]/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
}

export async function getDefaultBranch(cwd?: string): Promise<string | ToolError> {
	const symref = await runGit(["symbolic-ref", "refs/remotes/origin/HEAD"], cwd);
	if (symref.ok) {
		const ref = symref.stdout.trim(); // e.g. "refs/remotes/origin/main"
		const branch = ref.replace("refs/remotes/origin/", "");
		if (branch) return branch;
	}

	const remoteShow = await runGit(["remote", "show", "origin"], cwd);
	if (remoteShow.ok) {
		const match = remoteShow.stdout.match(/HEAD branch:\s*(.+)/);
		if (match?.[1]) return match[1].trim();
	}

	const mainCheck = await runGit(["rev-parse", "--verify", "main"], cwd);
	if (mainCheck.ok) return "main";

	const masterCheck = await runGit(["rev-parse", "--verify", "master"], cwd);
	if (masterCheck.ok) return "master";

	return makeToolError("Could not determine the default branch. No origin remote and neither 'main' nor 'master' exists locally.", "GIT_COMMAND_FAILED");
}

export async function branchExists(branch: string, cwd?: string): Promise<boolean> {
	const result = await runGit(["rev-parse", "--verify", branch], cwd);
	return result.ok;
}

export async function isDirty(cwd: string): Promise<boolean> {
	const result = await runGit(["status", "--porcelain"], cwd);
	if (!result.ok) return false;
	return result.stdout.trim().length > 0;
}

export async function unpushedCount(cwd: string): Promise<number> {
	const result = await runGit(["rev-list", "--count", "@{upstream}..HEAD"], cwd);
	if (!result.ok) return 0; // no upstream set
	const count = parseInt(result.stdout.trim(), 10);
	return isNaN(count) ? 0 : count;
}

export async function listWorktrees(cwd?: string): Promise<WorktreeInfo[] | ToolError> {
	const commonRepoRoot = await getCommonRepoRoot(cwd);
	if (isToolError(commonRepoRoot)) return commonRepoRoot;

	const result = await runGit(["worktree", "list", "--porcelain"], cwd);
	if (!result.ok) {
		return makeToolError(`Failed to list worktrees: ${result.stderr}`, "GIT_COMMAND_FAILED");
	}

	const worktrees: WorktreeInfo[] = [];
	const blocks = result.stdout.split("\n\n");

	for (const block of blocks) {
		const lines = block.trim().split("\n");
		if (lines.length === 0) continue;

		let worktreePath: string | undefined;
		let branch: string | undefined;
		let isBare = false;

		for (const line of lines) {
			if (line.startsWith("worktree ")) {
				worktreePath = line.slice("worktree ".length);
			} else if (line.startsWith("branch ")) {
				branch = line.slice("branch ".length).replace("refs/heads/", "");
			} else if (line === "bare") {
				isBare = true;
			}
		}

		if (!worktreePath || isBare) continue;

		const isMain = path.resolve(worktreePath) === path.resolve(commonRepoRoot);
		worktrees.push({
			path: worktreePath,
			branch,
			isMainWorktree: isMain,
			dirty: false, // filled in later by caller if needed
			unpushedCount: 0,
		});
	}

	return worktrees;
}

export function findWorktreeByBranch(worktrees: WorktreeInfo[], branch: string): WorktreeInfo | undefined {
	return worktrees.find((wt) => wt.branch === branch);
}
