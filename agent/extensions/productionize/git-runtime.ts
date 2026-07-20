import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { access } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import {
	formatGitCommandFailure,
	isLikelyGitLockFailure,
	isLikelyTransientGitFailure,
	type StepId,
} from "./core.ts";
import { WorkflowFailure, type ExecResult, type ProductionizeState } from "./types.ts";

const COMMAND_TIMEOUT_MS = 120_000;
export const REPOSITORY_IDENTITY_ARGS = ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-dir", "--git-common-dir"] as const;

export interface GitExecutionHooks {
	execCommand?: (
		command: string,
		args: string[],
		cwd: string,
		signal: AbortSignal,
		timeout: number,
	) => Promise<ExecResult>;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface GitRuntime {
	pi: ExtensionAPI;
	state: ProductionizeState;
	signal: AbortSignal;
	hooks: GitExecutionHooks;
}

export interface RepositoryIdentity {
	root: string;
	gitDir: string;
	commonDir: string;
}

export async function inspectRepository(runtime: GitRuntime, cwd: string): Promise<RepositoryIdentity> {
	const args = [...REPOSITORY_IDENTITY_ARGS];
	const result = await execCommand(runtime, "git", args, cwd, runtime.signal, 30_000);
	if (result.code !== 0) throw commandFailure("branch", "Repository check", "git", args, cwd, result);
	const [root, gitDir, commonDir] = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	if (!root || !gitDir || !commonDir) {
		throw new WorkflowFailure("branch", {
			step: "Repository check",
			command: "git",
			args,
			cwd,
			stdout: result.stdout,
			stderr: result.stderr,
			message: "Git did not return a complete repository identity.",
		});
	}
	return {
		root: normalizeGitPath(root, cwd),
		gitDir: normalizeGitPath(gitDir, cwd),
		commonDir: normalizeGitPath(commonDir, cwd),
	};
}

export function assertRepositoryIdentity(runtime: GitRuntime, current: RepositoryIdentity, cwd: string): void {
	const persisted = runtime.state.repository;
	if (persisted && (persisted.root !== current.root || persisted.gitDir !== current.gitDir || persisted.commonDir !== current.commonDir)) {
		throw new WorkflowFailure("branch", {
			step: "Repository check",
			command: "git",
			args: [...REPOSITORY_IDENTITY_ARGS],
			cwd,
			message: `This persisted productionize run belongs to ${persisted.root} (${persisted.gitDir}), not ${current.root} (${current.gitDir}). Start a fresh run in this worktree.`,
		});
	}
	runtime.state.repository = current;
}

export async function assertRelatedWorktree(runtime: GitRuntime, cwd: string, stepId: StepId): Promise<RepositoryIdentity> {
	const expected = runtime.state.repository;
	const candidate = await inspectRepository(runtime, cwd);
	if (!expected || candidate.commonDir !== expected.commonDir) {
		throw new WorkflowFailure(stepId, {
			step: stepId === "merge" ? "Merge" : "Return",
			command: "git",
			args: [...REPOSITORY_IDENTITY_ARGS],
			cwd,
			message: `Worktree path ${cwd} does not belong to the productionize repository. Refusing to run Git commands there.`,
		});
	}
	return candidate;
}

export async function assertNoRepositoryBlockers(runtime: GitRuntime, repository: RepositoryIdentity, cwd: string): Promise<void> {
	const operations: Array<{ path: string; label: string }> = [
		{ path: join(repository.gitDir, "MERGE_HEAD"), label: "merge" },
		{ path: join(repository.gitDir, "CHERRY_PICK_HEAD"), label: "cherry-pick" },
		{ path: join(repository.gitDir, "REVERT_HEAD"), label: "revert" },
		{ path: join(repository.gitDir, "rebase-merge"), label: "rebase" },
		{ path: join(repository.gitDir, "rebase-apply"), label: "rebase" },
		{ path: join(repository.gitDir, "sequencer"), label: "sequenced Git operation" },
	];
	for (const operation of operations) {
		if (!(await pathExists(operation.path))) continue;
		throw new WorkflowFailure("branch", {
			step: "Repository check",
			command: "git",
			cwd,
			message: `Cannot run /productionize while a ${operation.label} is in progress (${operation.path}). Finish or abort it first.`,
		});
	}

	const lockPaths = [
		join(repository.gitDir, "index.lock"),
		join(repository.gitDir, "HEAD.lock"),
		join(repository.commonDir, "packed-refs.lock"),
		join(repository.commonDir, "shallow.lock"),
	];
	for (const waitMs of [100, 250, 500]) {
		const locks = await existingPaths(lockPaths);
		if (locks.length === 0) return;
		await sleep(runtime, waitMs);
	}
	const locks = await existingPaths(lockPaths);
	if (locks.length === 0) return;
	throw new WorkflowFailure("branch", {
		step: "Repository check",
		command: "git",
		cwd,
		message: `Git is blocked by ${locks.join(", ")}. Productionize did not remove any lock. Confirm no Git process is running, then remove only verified stale locks and rerun /productionize.`,
	});
}

export async function localBranchExists(runtime: GitRuntime, cwd: string, branch: string): Promise<boolean> {
	const result = await execCommand(runtime, "git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd, runtime.signal, 30_000);
	return result.code === 0;
}

export async function availableBranchName(runtime: GitRuntime, cwd: string, requested: string): Promise<string> {
	if (!(await localBranchExists(runtime, cwd, requested))) return requested;
	for (let suffix = 2; suffix <= 100; suffix++) {
		const candidate = `${requested}-${suffix}`;
		if (!(await localBranchExists(runtime, cwd, candidate))) return candidate;
	}
	throw new WorkflowFailure("branch", {
		step: "Branch",
		command: "git",
		args: ["show-ref", "--verify", `refs/heads/${requested}-<n>`],
		cwd,
		message: `Could not find an available productionize branch name after 100 attempts for ${requested}.`,
	});
}

export async function verifyCurrentBranch(runtime: GitRuntime, cwd: string, expected: string, stepId: StepId = "branch"): Promise<void> {
	const step = stepId === "push" ? "Push" : "Branch";
	const result = await execOrFail(runtime, stepId, `Verify ${step.toLowerCase()} branch`, "git", ["branch", "--show-current"], cwd, 30_000);
	if (result.stdout.trim() === expected) return;
	throw new WorkflowFailure(stepId, {
		step,
		command: "git",
		args: ["branch", "--show-current"],
		cwd,
		stdout: result.stdout,
		stderr: result.stderr,
		message: `Git reported success, but the current branch is ${result.stdout.trim() || "detached HEAD"} instead of ${expected}.`,
	});
}

export async function readUpstreamTarget(runtime: GitRuntime, cwd: string, branch: string): Promise<{ remote: string; remoteRef: string }> {
	const args = ["for-each-ref", "--format=%(upstream:remotename)%00%(upstream:remoteref)", `refs/heads/${branch}`];
	const result = await execOrFail(runtime, "push", "Inspect upstream", "git", args, cwd, 30_000);
	const [remote, remoteRef] = result.stdout.trim().split("\0");
	if (!remote || !remoteRef?.startsWith("refs/heads/")) {
		throw new WorkflowFailure("push", {
			step: "Push",
			command: "git",
			args,
			cwd,
			stdout: result.stdout,
			stderr: result.stderr,
			message: `Could not determine the upstream target for ${branch}.`,
		});
	}
	return { remote, remoteRef };
}

export async function verifyRemoteBranch(runtime: GitRuntime, cwd: string, remote: string, remoteRef: string, branch: string): Promise<void> {
	const head = await execOrFail(runtime, "push", "Read local HEAD", "git", ["rev-parse", "HEAD"], cwd, 30_000);
	const remoteHead = await execOrFail(runtime, "push", "Verify remote branch", "git", ["ls-remote", "--heads", remote, remoteRef], cwd, 60_000);
	const remoteOid = remoteHead.stdout.trim().split(/\s+/)[0];
	if (remoteOid && remoteOid === head.stdout.trim()) return;
	throw new WorkflowFailure("push", {
		step: "Push",
		command: "git",
		args: ["ls-remote", "--heads", remote, remoteRef],
		cwd,
		stdout: remoteHead.stdout,
		stderr: remoteHead.stderr,
		message: `Push returned successfully, but ${remote}/${branch} does not contain local HEAD ${head.stdout.trim()}. Productionize stopped before opening a pull request.`,
	});
}

export async function execOrFail(
	runtime: GitRuntime,
	stepId: StepId,
	step: string,
	command: string,
	args: string[],
	cwd: string,
	timeout = COMMAND_TIMEOUT_MS,
): Promise<ExecResult> {
	const result = await execCommand(runtime, command, args, cwd, runtime.signal, timeout);
	if (result.code !== 0) throw commandFailure(stepId, step, command, args, cwd, result);
	return result;
}

export function commandFailure(stepId: StepId, step: string, command: string, args: string[], cwd: string, result: ExecResult): WorkflowFailure {
	const guidance = command === "git" ? formatGitCommandFailure(args, result.stdout, result.stderr) : undefined;
	return new WorkflowFailure(stepId, {
		step,
		command,
		args,
		cwd,
		code: result.code,
		killed: result.killed,
		stdout: result.stdout,
		stderr: result.stderr,
		message: result.killed
			? `${command} ${args.join(" ")} was terminated before it completed, likely because it timed out.`
			: guidance ?? `${command} ${args.join(" ")} exited ${result.code}`,
	});
}

export async function execCommand(
	runtime: GitRuntime,
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal,
	timeout = COMMAND_TIMEOUT_MS,
): Promise<ExecResult> {
	for (let attempt = 0; attempt < 3; attempt++) {
		const result = await execCommandOnce(runtime, command, args, cwd, signal, timeout);
		if (
			result.code === 0
			|| command !== "git"
			|| !isRetryableGitFailure(args, result)
			|| attempt === 2
		) return result;
		await sleep(runtime, attempt === 0 ? 150 : 400);
	}
	return { code: 1, stdout: "", stderr: "Git command retry loop ended unexpectedly." };
}

function isRetryableGitFailure(args: string[], result: ExecResult): boolean {
	if (result.killed) return false;
	if (!isRetrySafeGitCommand(args)) return false;
	return isLikelyGitLockFailure(result.stdout, result.stderr) || isLikelyTransientGitFailure(result.stdout, result.stderr);
}

function isRetrySafeGitCommand(args: string[]): boolean {
	const command = args[0];
	if (["rev-parse", "status", "show-ref", "for-each-ref", "ls-remote", "diff", "log", "rev-list", "ls-files"].includes(command ?? "")) return true;
	if (command === "branch") return args.includes("--show-current") || args.includes("--list");
	if (command === "config") return args.length === 2 || args.includes("--get");
	if (command === "remote") return args.length === 1 || args[1] === "get-url";
	if (command === "push") return !args.some((arg) =>
		arg === "-f"
			|| arg.startsWith("--force")
			|| arg === "-d"
			|| arg === "--delete"
			|| arg.startsWith("--delete=")
			|| arg === "--mirror"
			|| arg === "--all"
			|| arg === "--tags"
			|| arg === "--prune"
			|| arg.startsWith("--prune=")
	);
	return false;
}

async function execCommandOnce(
	runtime: GitRuntime,
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal,
	timeout: number,
): Promise<ExecResult> {
	if (runtime.hooks.execCommand) return runtime.hooks.execCommand(command, args, cwd, signal, timeout);
	try {
		const result = await runtime.pi.exec(command, args, { cwd, timeout, signal });
		return { code: result.code, stdout: result.stdout, stderr: result.stderr, killed: result.killed };
	} catch (error) {
		if (signal.aborted) throw error;
		return { code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
	}
}

async function existingPaths(paths: string[]): Promise<string[]> {
	const found: string[] = [];
	for (const path of paths) if (await pathExists(path)) found.push(path);
	return found;
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch (error) {
		return (error as { code?: string }).code !== "ENOENT";
	}
}

function normalizeGitPath(path: string, cwd: string): string {
	return resolve(isAbsolute(path) ? path : join(cwd, path));
}

async function sleep(runtime: GitRuntime, ms: number): Promise<void> {
	if (runtime.hooks.sleep) return runtime.hooks.sleep(ms, runtime.signal);
	return delay(ms, runtime.signal);
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolveDelay, reject) => {
		if (signal.aborted) {
			reject(new Error("cancelled"));
			return;
		}
		const onComplete = () => {
			signal.removeEventListener("abort", onAbort);
			resolveDelay();
		};
		const timeout = setTimeout(onComplete, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			signal.removeEventListener("abort", onAbort);
			reject(new Error("cancelled"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
