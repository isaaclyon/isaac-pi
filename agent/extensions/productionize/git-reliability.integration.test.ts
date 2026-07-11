import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createDefaultSnapshot } from "./auto.ts";
import { createInitialState, runWorkflow } from "./workflow.ts";
import type { ExecResult } from "./types.ts";

const execFileAsync = promisify(execFile);

test("productionize leaves repository locks untouched and reports safe recovery", async () => {
	await withRepository(async ({ work }) => {
		const lockPath = join(work, ".git", "index.lock");
		await writeFile(lockPath, "");
		const state = createInitialState({ startFrom: "branch", stopAfter: "branch" });

		await runWorkflow(createFakePi(), createFakeContext(work), state, new AbortController().signal, () => undefined, { startFrom: "branch", stopAfter: "branch" }, {
			execCommand: execute,
			sleep: async () => undefined,
		});

		assert.equal(state.outcome, "failed");
		assert.match(state.failure?.message ?? "", /index\.lock/i);
		assert.match(state.failure?.message ?? "", /did not remove/i);
		assert.equal(await fileExists(lockPath), true);
	});
});

test("productionize detects rebase metadata even when REBASE_HEAD is absent", async () => {
	await withRepository(async ({ work }) => {
		await mkdir(join(work, ".git", "rebase-merge"));
		const state = createInitialState({ startFrom: "branch", stopAfter: "branch" });

		await runWorkflow(createFakePi(), createFakeContext(work), state, new AbortController().signal, () => undefined, { startFrom: "branch", stopAfter: "branch" }, {
			execCommand: execute,
		});

		assert.equal(state.outcome, "failed");
		assert.match(state.failure?.message ?? "", /rebase is in progress/i);
	});
});

test("return recreates a locally deleted base branch from its persisted remote when multiple remotes match", async () => {
	await withRepository(async ({ root, work }) => {
		const backup = join(root, "backup.git");
		await git(root, "init", "--bare", backup);
		await git(work, "remote", "add", "backup", backup);
		await git(work, "push", "backup", "main");
		await git(work, "switch", "-c", "feat/test");
		await git(work, "branch", "-D", "main");
		const state = createDefaultSnapshot();
		state.remote = "origin";
		state.branch = "feat/test";
		state.returnToBranch = "main";
		state.returnRemote = "origin";
		for (const step of state.steps) step.status = step.id === "return" ? "pending" : "done";

		await runWorkflow(createFakePi(), createFakeContext(work), state, new AbortController().signal, () => undefined, {}, { execCommand: execute });

		assert.equal(state.outcome, "succeeded");
		assert.equal((await git(work, "branch", "--show-current")).trim(), "main");
		assert.equal((await git(work, "rev-parse", "main")).trim(), (await git(work, "rev-parse", "origin/main")).trim());
		assert.match(state.steps.find((step) => step.id === "return")?.detail ?? "", /recreated/i);
	});
});

test("return updates a base branch that is checked out in another worktree", async () => {
	await withRepository(async ({ root, work }) => {
		const mainWorktree = join(root, "main-worktree");
		await git(work, "switch", "-c", "feat/worktree-return");
		await git(work, "worktree", "add", mainWorktree, "main");
		const state = createDefaultSnapshot();
		state.remote = "origin";
		state.branch = "feat/worktree-return";
		state.returnToBranch = "main";
		state.returnRemote = "origin";
		for (const step of state.steps) step.status = step.id === "return" ? "pending" : "done";

		await runWorkflow(createFakePi(), createFakeContext(work), state, new AbortController().signal, () => undefined, {}, { execCommand: execute });

		assert.equal(state.outcome, "succeeded");
		assert.equal((await git(work, "branch", "--show-current")).trim(), "feat/worktree-return");
		assert.equal((await git(mainWorktree, "branch", "--show-current")).trim(), "main");
		assert.match(state.returnWarning ?? "", /existing worktree/i);
	});
});

test("push rejects divergence without force-pushing over remote work", async () => {
	await withRepository(async ({ root, work, remote }) => {
		await git(work, "switch", "-c", "feat/diverged");
		await writeFile(join(work, "local.txt"), "first\n");
		await git(work, "add", "local.txt");
		await git(work, "commit", "-m", "feat: add first local change");
		await git(work, "push", "-u", "origin", "feat/diverged");

		const other = join(root, "other");
		await git(root, "clone", "--branch", "feat/diverged", remote, other);
		await git(other, "config", "user.name", "Productionize Test");
		await git(other, "config", "user.email", "productionize@example.test");
		await writeFile(join(other, "remote.txt"), "remote\n");
		await git(other, "add", "remote.txt");
		await git(other, "commit", "-m", "feat: add remote change");
		await git(other, "push");
		const remoteHead = (await git(other, "rev-parse", "HEAD")).trim();

		await writeFile(join(work, "local.txt"), "second\n");
		await git(work, "add", "local.txt");
		await git(work, "commit", "-m", "feat: add second local change");
		const state = createInitialState({ startFrom: "branch", stopAfter: "push" });

		await runWorkflow(createFakePi(), createFakeContext(work), state, new AbortController().signal, () => undefined, { startFrom: "branch", stopAfter: "push" }, { execCommand: execute });

		assert.equal(state.outcome, "failed");
		assert.match(state.failure?.message ?? "", /never force-push/i);
		assert.equal((await git(remote, "rev-parse", "refs/heads/feat/diverged")).trim(), remoteHead);
	});
});

test("push verifies that the remote branch contains the local HEAD", async () => {
	await withRepository(async ({ work, remote }) => {
		await git(work, "switch", "-c", "feat/push-proof");
		await writeFile(join(work, "feature.txt"), "feature\n");
		await git(work, "add", "feature.txt");
		await git(work, "commit", "-m", "feat: add proof");
		const state = createInitialState({ startFrom: "branch", stopAfter: "push" });

		await runWorkflow(createFakePi(), createFakeContext(work), state, new AbortController().signal, () => undefined, { startFrom: "branch", stopAfter: "push" }, { execCommand: execute });

		assert.equal(state.outcome, "succeeded");
		assert.equal((await git(work, "rev-parse", "HEAD")).trim(), (await git(remote, "rev-parse", "refs/heads/feat/push-proof")).trim());
	});
});

async function withRepository(run: (repo: { root: string; work: string; remote: string }) => Promise<void>): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "productionize-git-"));
	const work = join(root, "work");
	const remote = join(root, "remote.git");
	try {
		await git(root, "init", "--bare", remote);
		await git(root, "init", "-b", "main", work);
		await git(work, "config", "user.name", "Productionize Test");
		await git(work, "config", "user.email", "productionize@example.test");
		await writeFile(join(work, "README.md"), "test\n");
		await git(work, "add", "README.md");
		await git(work, "commit", "-m", "chore: initialize");
		await git(work, "remote", "add", "origin", remote);
		await git(work, "push", "-u", "origin", "main");
		await run({ root, work, remote });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

async function execute(command: string, args: string[], cwd: string, signal: AbortSignal, timeout: number): Promise<ExecResult> {
	try {
		const result = await execFileAsync(command, args, { cwd, signal, timeout, encoding: "utf8" });
		return { code: 0, stdout: result.stdout, stderr: result.stderr };
	} catch (error) {
		const failure = error as { code?: number | string; stdout?: string; stderr?: string; killed?: boolean; message?: string };
		return {
			code: typeof failure.code === "number" ? failure.code : 1,
			stdout: failure.stdout ?? "",
			stderr: failure.stderr ?? failure.message ?? String(error),
			killed: failure.killed,
		};
	}
}

async function git(cwd: string, ...args: string[]): Promise<string> {
	const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
	return result.stdout;
}

async function fileExists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function createFakePi(): any {
	return { appendEntry() {}, sendMessage() {} };
}

function createFakeContext(cwd: string): any {
	return {
		cwd,
		sessionManager: { getBranch: () => [] },
		modelRegistry: {
			find: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }),
		},
	};
}
