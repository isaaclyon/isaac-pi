import { execFile } from "node:child_process";
import { access, appendFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import type { CommandResult, CommandRunner, IsolationState, RepositoryInfo } from "./types.ts";

const DEFAULT_TIMEOUT_MS = 300_000;
const OWNER_MARKER = "pi-isolate-owner";

export async function findGitCommonDir(cwd: string, runner: CommandRunner = runCommand): Promise<string> {
	const result = await gitOrFail(
		runner,
		cwd,
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
		"Inspect Git common directory",
	);
	return resolve(result.stdout.trim());
}

export async function inspectRepository(cwd: string, runner: CommandRunner = runCommand): Promise<RepositoryInfo> {
	const rootResult = await gitOrFail(runner, cwd, ["rev-parse", "--show-toplevel"], "Inspect repository root");
	const commonDirResult = await gitOrFail(
		runner,
		cwd,
		["rev-parse", "--path-format=absolute", "--git-common-dir"],
		"Inspect Git common directory",
	);
	const branchResult = await gitOrFail(runner, cwd, ["branch", "--show-current"], "Inspect current branch");
	const root = rootResult.stdout.trim();
	const commonDir = commonDirResult.stdout.trim();
	const branch = branchResult.stdout.trim();
	if (!branch) throw new Error("Pi isolation requires an attached, existing local branch.");
	const headResult = await gitOrFail(runner, cwd, ["rev-parse", "HEAD"], "Inspect current commit");
	const head = headResult.stdout.trim();
	return { root: resolve(root), commonDir: resolve(commonDir), branch, head };
}

export async function createWorktree(state: IsolationState, runner: CommandRunner = runCommand): Promise<void> {
	assertOwnedState(state);
	const repository = await inspectRepository(state.sourceCwd, runner);
	assertRepository(state, repository);
	await assertExistingWorktreeDirectorySafe(state);
	await assertCleanWorktree(runner, state.repositoryRoot, "original worktree");
	await assertNoGitOperation(runner, state.sourceCwd);
	if (await pathExists(state.worktreePath)) throw new Error(`Isolation worktree path already exists: ${state.worktreePath}`);
	const branchExists = await runner("git", ["show-ref", "--verify", "--quiet", `refs/heads/${state.worktreeBranch}`], state.repositoryRoot);
	if (branchExists.code === 0) throw new Error(`Isolation branch already exists: ${state.worktreeBranch}`);

	await ensureSafeWorktreeDirectory(state, runner);
	await gitOrFail(
		runner,
		state.repositoryRoot,
		["worktree", "add", "-b", state.worktreeBranch, state.worktreePath, state.baseHead],
		"Create isolation worktree",
	);

	const created = await inspectRepository(state.worktreeCwd, runner);
	if (created.commonDir !== state.gitCommonDir || created.branch !== state.worktreeBranch) {
		throw new Error("Created worktree does not match the persisted isolation identity.");
	}
	const gitDirResult = await gitOrFail(runner, state.worktreeCwd, ["rev-parse", "--absolute-git-dir"], "Record worktree ownership");
	state.worktreeGitDir = resolve(gitDirResult.stdout.trim());
	await writeFile(join(state.worktreeGitDir, OWNER_MARKER), `${state.id}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function integrateWorktree(
	state: IsolationState,
	runner: CommandRunner = runCommand,
	hooks: { onRebased?(head: string, expectedParentHead: string): Promise<void> } = {},
): Promise<string> {
	assertOwnedState(state);
	await verifyWorktreeOwnership(state, runner);
	const isolated = await inspectRepository(state.worktreeCwd, runner);
	if (isolated.commonDir !== state.gitCommonDir || isolated.branch !== state.worktreeBranch) {
		throw new Error("Current isolated worktree no longer matches its recorded repository and branch.");
	}
	const parent = await inspectRepository(state.repositoryRoot, runner);
	assertRepository(state, parent);
	if (parent.branch !== state.baseBranch) {
		throw new Error(`Original worktree is on ${parent.branch}, expected ${state.baseBranch}; remain isolated until it is restored.`);
	}
	await assertCleanWorktree(runner, state.repositoryRoot, "original worktree");
	await assertNoGitOperation(runner, state.worktreeCwd);
	await assertNoGitOperation(runner, state.repositoryRoot);
	await gitOrFail(
		runner,
		state.worktreeCwd,
		["merge-base", "--is-ancestor", state.baseHead, "HEAD"],
		"Verify isolated history",
	);

	await gitOrFail(runner, state.worktreeCwd, ["add", "-A"], "Stage isolated changes");
	const staged = await runner("git", ["diff", "--cached", "--quiet"], state.worktreeCwd);
	if (staged.code !== 0 && staged.code !== 1) throw commandError("Inspect staged isolated changes", staged);
	if (staged.code === 1) {
		await gitOrFail(
			runner,
			state.worktreeCwd,
			["commit", "-m", commitSubject(state.task)],
			"Commit isolated changes",
		);
	}

	const parentHeadResult = await gitOrFail(runner, state.repositoryRoot, ["rev-parse", "HEAD"], "Read original branch head");
	const expectedParentHead = parentHeadResult.stdout.trim();
	const rebase = await runner("git", ["rebase", expectedParentHead], state.worktreeCwd, { timeout: 300_000 });
	if (rebase.code !== 0) {
		throw commandError("Rebase isolated work onto the original branch; resolve the conflict here, continue the rebase, then retry finish", rebase);
	}
	const isolatedHeadResult = await gitOrFail(runner, state.worktreeCwd, ["rev-parse", "HEAD"], "Read rebased isolation head");
	const integratedHead = isolatedHeadResult.stdout.trim();
	await hooks.onRebased?.(integratedHead, expectedParentHead);

	const refreshedParent = await inspectRepository(state.repositoryRoot, runner);
	if (refreshedParent.branch !== state.baseBranch) {
		throw new Error(`Original worktree changed branches during integration; expected ${state.baseBranch}.`);
	}
	await assertCleanWorktree(runner, state.repositoryRoot, "original worktree");
	await gitOrFail(
		runner,
		state.repositoryRoot,
		["merge", "--ff-only", integratedHead],
		"Fast-forward original branch",
	);
	const finalParentResult = await gitOrFail(runner, state.repositoryRoot, ["rev-parse", "HEAD"], "Verify original branch head");
	const finalParentHead = finalParentResult.stdout.trim();
	if (finalParentHead !== integratedHead) throw new Error("Original branch did not reach the verified isolated commit.");
	await assertCleanWorktree(runner, state.repositoryRoot, "original worktree after integration");
	return integratedHead;
}

export async function cleanupWorktree(
	state: IsolationState,
	options: { force: boolean },
	runner: CommandRunner = runCommand,
	hooks: { onVerified?(branchHead: string | undefined): Promise<void> } = {},
): Promise<void> {
	assertOwnedState(state);
	if (options.force && (state.integratedHead || await isWorkIntegrated(state, runner))) {
		throw new Error("Isolation work is already integrated and cannot be discarded.");
	}
	const pathPresent = await pathExists(state.worktreePath);
	let branchHead = state.cleanupBranchHead;
	if (pathPresent || await registeredWorktreeExists(state, runner)) {
		branchHead = await verifyWorktreeOwnership(state, runner);
		await hooks.onVerified?.(branchHead);
	} else if (!branchHead && await temporaryBranchExists(state, runner)) {
		throw new Error("Isolation ownership proof is missing; refusing to delete its remaining branch.");
	}
	if (pathPresent) {
		const args = ["worktree", "remove"];
		if (options.force) args.push("--force");
		args.push(state.worktreePath);
		await gitOrFail(runner, state.repositoryRoot, args, "Remove isolation worktree");
	}
	const worktrees = await gitOrFail(runner, state.repositoryRoot, ["worktree", "list", "--porcelain"], "Verify worktree removal");
	if (porcelainWorktreePaths(worktrees.stdout).includes(resolve(state.worktreePath))) {
		throw new Error(`Git still reports the isolation worktree at ${state.worktreePath}.`);
	}

	await deleteTemporaryBranch(state, options.force, runner, branchHead);
}

export async function isWorkIntegrated(state: IsolationState, runner: CommandRunner = runCommand): Promise<boolean> {
	const candidate = state.integratedHead ?? state.rebasedHead;
	if (!candidate) return false;
	const result = await runner("git", ["merge-base", "--is-ancestor", candidate, state.baseBranch], state.repositoryRoot);
	if (result.code === 0) return true;
	if (result.code === 1) return false;
	throw commandError("Check whether isolated work was already integrated", result);
}

export async function describeDiscard(state: IsolationState, runner: CommandRunner = runCommand): Promise<string> {
	assertOwnedState(state);
	const status = await gitOrFail(
		runner,
		state.worktreeCwd,
		["status", "--short", "--untracked-files=all"],
		"Inspect isolated changes before discard",
	);
	const unique = await gitOrFail(
		runner,
		state.worktreeCwd,
		["rev-list", "--count", `${state.baseBranch}..${state.worktreeBranch}`],
		"Count isolated commits before discard",
	);
	const count = Number.parseInt(unique.stdout.trim(), 10) || 0;
	const files = status.stdout.trim().split(/\r?\n/).filter(Boolean).slice(0, 20);
	return [
		`${count} unique commit${count === 1 ? "" : "s"} will be deleted.`,
		files.length ? `Uncommitted files:\n${files.join("\n")}` : "No uncommitted files.",
	].join("\n\n");
}

export const runCommand: CommandRunner = async (command, args, cwd, options = {}) => {
	return new Promise<CommandResult>((resolveResult) => {
		execFile(
			command,
			args,
			{ cwd, encoding: "utf8", timeout: options.timeout ?? DEFAULT_TIMEOUT_MS, signal: options.signal },
			(error, stdout, stderr) => {
				const failure = error as (Error & { code?: number | string }) | null;
				let code = 0;
				if (failure) code = typeof failure.code === "number" ? failure.code : 1;
				resolveResult({
					code,
					stdout: stdout ?? "",
					stderr: stderr || failure?.message || "",
				});
			},
		);
	});
};

async function assertExistingWorktreeDirectorySafe(state: IsolationState): Promise<void> {
	const worktreesDir = join(state.repositoryRoot, ".worktrees");
	let stats;
	try {
		stats = await lstat(worktreesDir);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	if (stats.isSymbolicLink() || !stats.isDirectory()) {
		throw new Error(`${worktreesDir} must be a real directory, not a symlink or file.`);
	}
}

async function deleteTemporaryBranch(
	state: IsolationState,
	force: boolean,
	runner: CommandRunner,
	ownedHead: string | undefined,
): Promise<void> {
	const ref = `refs/heads/${state.worktreeBranch}`;
	const branch = await runner("git", ["rev-parse", "--verify", "--quiet", ref], state.repositoryRoot);
	if (branch.code === 1) return;
	if (branch.code !== 0) throw commandError("Inspect isolation branch before deletion", branch);
	const expectedOid = branch.stdout.trim();
	if (!ownedHead || expectedOid !== ownedHead) {
		throw new Error("Isolation branch changed after ownership verification; refusing to delete it.");
	}
	if (!force) {
		if (!state.integratedHead || expectedOid !== state.integratedHead) {
			throw new Error("Isolation branch changed after integration; refusing to delete it.");
		}
		await gitOrFail(
			runner,
			state.repositoryRoot,
			["merge-base", "--is-ancestor", expectedOid, state.baseBranch],
			"Verify integrated branch",
		);
	}
	await gitOrFail(runner, state.repositoryRoot, ["update-ref", "-d", ref, expectedOid], "Delete isolation branch");
}

async function verifyWorktreeOwnership(state: IsolationState, runner: CommandRunner): Promise<string | undefined> {
	const entries = await worktreeEntries(state, runner);
	const entry = entries.find((candidate) => candidate.path === resolve(state.worktreePath));
	if (!entry) throw new Error("Git no longer records the managed isolation worktree; ownership cannot be verified.");

	if (state.worktreeGitDir) {
		let owner: string;
		try {
			owner = (await readFile(join(state.worktreeGitDir, OWNER_MARKER), "utf8")).trim();
		} catch {
			throw new Error("Isolation worktree owner marker is missing; refusing cleanup.");
		}
		if (owner !== state.id) throw new Error("Isolation worktree owner marker does not match this job.");
		if (await pathExists(state.worktreePath)) {
			const stats = await lstat(state.worktreePath);
			if (stats.isSymbolicLink() || !stats.isDirectory()) {
				throw new Error("Isolation worktree path is no longer an owned directory.");
			}
			const actualCommonDir = await findGitCommonDir(state.worktreePath, runner);
			const actualGitDirResult = await gitOrFail(runner, state.worktreePath, ["rev-parse", "--absolute-git-dir"], "Verify worktree Git directory");
			if (actualCommonDir !== resolve(state.gitCommonDir) || resolve(actualGitDirResult.stdout.trim()) !== resolve(state.worktreeGitDir)) {
				throw new Error("Isolation worktree ownership does not match the recorded Git directories.");
			}
		}
	} else if (state.phase !== "creating" || entry.branch !== `refs/heads/${state.worktreeBranch}` || entry.head !== state.baseHead) {
		throw new Error("Isolation worktree has no persisted ownership marker; refusing cleanup.");
	}

	const branch = await runner("git", ["show-ref", "--verify", "--hash", `refs/heads/${state.worktreeBranch}`], state.repositoryRoot);
	if (branch.code === 1) return undefined;
	if (branch.code !== 0) throw commandError("Verify owned isolation branch", branch);
	if (entry.branch && entry.branch !== `refs/heads/${state.worktreeBranch}`) {
		throw new Error("The recorded isolation path now belongs to a different branch.");
	}
	return branch.stdout.trim();
}

async function registeredWorktreeExists(state: IsolationState, runner: CommandRunner): Promise<boolean> {
	return (await worktreeEntries(state, runner)).some((entry) => entry.path === resolve(state.worktreePath));
}

async function temporaryBranchExists(state: IsolationState, runner: CommandRunner): Promise<boolean> {
	const result = await runner("git", ["show-ref", "--verify", "--quiet", `refs/heads/${state.worktreeBranch}`], state.repositoryRoot);
	if (result.code === 0) return true;
	if (result.code === 1) return false;
	throw commandError("Inspect isolation branch", result);
}

async function worktreeEntries(
	state: IsolationState,
	runner: CommandRunner,
): Promise<Array<{ path: string; head?: string; branch?: string }>> {
	const result = await gitOrFail(runner, state.repositoryRoot, ["worktree", "list", "--porcelain"], "Inspect repository worktrees");
	return result.stdout.trim().split(/\r?\n\r?\n/).flatMap((block) => {
		const lines = block.split(/\r?\n/);
		const path = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
		if (!path) return [];
		return [{
			path: resolve(path),
			head: lines.find((line) => line.startsWith("HEAD "))?.slice("HEAD ".length),
			branch: lines.find((line) => line.startsWith("branch "))?.slice("branch ".length),
		}];
	});
}

async function ensureSafeWorktreeDirectory(state: IsolationState, runner: CommandRunner): Promise<void> {
	const worktreesDir = join(state.repositoryRoot, ".worktrees");
	if (await pathExists(worktreesDir)) {
		const stats = await lstat(worktreesDir);
		if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`${worktreesDir} must be a real directory, not a symlink or file.`);
	} else {
		await mkdir(worktreesDir, { recursive: false });
	}
	const tracked = await gitOrFail(runner, state.repositoryRoot, ["ls-files", "--", ".worktrees"], "Inspect .worktrees tracking");
	if (tracked.stdout.trim()) throw new Error("Refusing to use .worktrees because Git already tracks content there.");
	const excludePath = join(state.gitCommonDir, "info", "exclude");
	await mkdir(dirname(excludePath), { recursive: true });
	let excluded = "";
	try {
		excluded = await readFile(excludePath, "utf8");
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
	}
	if (!excluded.split(/\r?\n/).includes("/.worktrees/")) {
		await appendFile(excludePath, `${excluded && !excluded.endsWith("\n") ? "\n" : ""}/.worktrees/\n`);
	}
}

async function assertCleanWorktree(runner: CommandRunner, cwd: string, label: string): Promise<void> {
	const status = await gitOrFail(runner, cwd, ["status", "--porcelain", "--untracked-files=all"], `Inspect ${label}`);
	if (status.stdout.trim()) throw new Error(`The ${label} is dirty. Commit, stash, or remove its changes before continuing isolation.`);
}

async function assertNoGitOperation(runner: CommandRunner, cwd: string): Promise<void> {
	for (const [label, ref] of [
		["merge", "MERGE_HEAD"],
		["cherry-pick", "CHERRY_PICK_HEAD"],
		["revert", "REVERT_HEAD"],
	] as const) {
		const operationRef = await runner("git", ["rev-parse", "-q", "--verify", ref], cwd);
		if (operationRef.code === 0) {
			throw new Error(`A Git ${label} is already in progress in ${cwd}.`);
		}
	}
	for (const name of ["rebase-merge", "rebase-apply", "sequencer"]) {
		const pathResult = await gitOrFail(runner, cwd, ["rev-parse", "--git-path", name], "Inspect Git operation state");
		const path = pathResult.stdout.trim();
		if (await pathExists(resolve(cwd, path))) throw new Error(`A Git operation (${name}) is already in progress in ${cwd}.`);
	}
}

function assertOwnedState(state: IsolationState): void {
	const worktreesRoot = resolve(state.repositoryRoot, ".worktrees");
	const ownedPath = resolve(state.worktreePath);
	if (dirname(ownedPath) !== worktreesRoot || relative(worktreesRoot, ownedPath).startsWith(`..${sep}`)) {
		throw new Error(`Refusing to manage worktree outside ${worktreesRoot}.`);
	}
	if (!state.worktreeBranch.startsWith("pi-isolate/") || !state.worktreeBranch.includes(state.id)) {
		throw new Error("Refusing to manage a branch that does not match the isolation job identity.");
	}
	if (state.worktreeGitDir && dirname(resolve(state.worktreeGitDir)) !== resolve(state.gitCommonDir, "worktrees")) {
		throw new Error("Refusing a worktree Git directory outside the repository's administrative worktree directory.");
	}
}

function assertRepository(state: IsolationState, repository: RepositoryInfo): void {
	if (repository.root !== resolve(state.repositoryRoot) || repository.commonDir !== resolve(state.gitCommonDir)) {
		throw new Error("Isolation state belongs to a different repository or worktree.");
	}
}

async function gitOrFail(
	runner: CommandRunner,
	cwd: string,
	args: string[],
	step: string,
): Promise<CommandResult> {
	const result = await runner("git", args, cwd, { timeout: DEFAULT_TIMEOUT_MS });
	if (result.code !== 0) throw commandError(step, result);
	return result;
}

function commandError(step: string, result: CommandResult): Error {
	const detail = [result.stderr.trim(), result.stdout.trim()].filter(Boolean).join("\n");
	return new Error(`${step} failed${detail ? `:\n${detail}` : ""}`);
}

function commitSubject(task: string): string {
	const firstLine = task.split(/\r?\n/, 1)[0] ?? "";
	const normalized = firstLine.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
	return `isolate: ${(normalized || "complete isolated task").slice(0, 60)}`;
}

function porcelainWorktreePaths(output: string): string[] {
	return output
		.split(/\r?\n/)
		.flatMap((line) => line.startsWith("worktree ") ? [resolve(line.slice("worktree ".length))] : []);
}

async function pathExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
