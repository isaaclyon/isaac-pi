import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { cleanupWorktree, createWorktree, describeDiscard, findGitCommonDir, inspectRepository, integrateWorktree } from "./git.ts";
import type { IsolationState } from "./types.ts";

const execFileAsync = promisify(execFile);

test("creates an ignored task worktree, integrates by rebase and fast-forward, then removes it", async () => {
	await withRepository(async (root) => {
		const repository = await inspectRepository(root);
		const state = createState(repository, "feature");

		await createWorktree(state);
		assert.equal(await exists(state.worktreePath), true);
		assert.equal((await git(state.worktreePath, "branch", "--show-current")).trim(), state.worktreeBranch);
		assert.match(await readFile(join(repository.commonDir, "info", "exclude"), "utf8"), /^\/\.worktrees\/$/m);

		await writeFile(join(state.worktreePath, "feature.txt"), "isolated\n");
		let persistedBeforeFastForward = false;
		const integratedHead = await integrateWorktree(state, undefined, {
			async onRebased(head, expectedParentHead) {
				persistedBeforeFastForward = true;
				assert.equal((await git(root, "rev-parse", "HEAD")).trim(), expectedParentHead);
				assert.equal((await git(state.worktreePath, "rev-parse", "HEAD")).trim(), head);
			},
		});
		state.integratedHead = integratedHead;

		assert.equal(persistedBeforeFastForward, true);
		assert.equal((await git(root, "rev-parse", "HEAD")).trim(), integratedHead);
		assert.equal((await git(state.worktreePath, "rev-parse", "HEAD")).trim(), integratedHead);
		assert.equal(await readFile(join(root, "feature.txt"), "utf8"), "isolated\n");

		await cleanupWorktree(state, { force: false });
		assert.equal(await exists(state.worktreePath), false);
		await assert.rejects(() => git(root, "show-ref", "--verify", `refs/heads/${state.worktreeBranch}`));
	});
});

test("cleans up when creation failed before the worktree or branch existed", async () => {
	await withRepository(async (root) => {
		const state = createState(await inspectRepository(root), "failed-creation");
		state.phase = "creating";

		await cleanupWorktree(state, { force: true });
		assert.equal(await exists(state.worktreePath), false);
	});
});

test("refuses to integrate while the original worktree is dirty", async () => {
	await withRepository(async (root) => {
		const state = createState(await inspectRepository(root), "dirty-base");
		await createWorktree(state);
		await writeFile(join(state.worktreePath, "feature.txt"), "isolated\n");
		await writeFile(join(root, "base.txt"), "uncommitted\n");

		await assert.rejects(() => integrateWorktree(state), /original worktree.*dirty/i);
		assert.equal(await exists(state.worktreePath), true);

		await cleanupWorktree(state, { force: true });
	});
});

test("rebases isolated work when the original branch advances before finish", async () => {
	await withRepository(async (root) => {
		const state = createState(await inspectRepository(root), "advanced-base");
		await createWorktree(state);
		await writeFile(join(state.worktreePath, "feature.txt"), "isolated\n");
		await writeFile(join(root, "base.txt"), "advanced\n");
		await git(root, "add", "base.txt");
		await git(root, "commit", "-m", "chore: advance base");

		state.integratedHead = await integrateWorktree(state);
		assert.equal((await git(root, "rev-parse", "HEAD")).trim(), state.integratedHead);
		assert.equal(await readFile(join(root, "base.txt"), "utf8"), "advanced\n");
		assert.equal(await readFile(join(root, "feature.txt"), "utf8"), "isolated\n");
		await cleanupWorktree(state, { force: false });
	});
});

test("keeps the isolation worktree on a rebase conflict", async () => {
	await withRepository(async (root) => {
		const state = createState(await inspectRepository(root), "conflict");
		await createWorktree(state);
		await writeFile(join(state.worktreePath, "README.md"), "isolated\n");
		await writeFile(join(root, "README.md"), "base\n");
		await git(root, "add", "README.md");
		await git(root, "commit", "-m", "chore: change base");

		await assert.rejects(() => integrateWorktree(state), /resolve the conflict here/i);
		assert.equal(await exists(state.worktreePath), true);
		assert.equal(await findGitCommonDir(state.worktreePath), state.gitCommonDir);
		assert.equal(await readFile(join(root, "README.md"), "utf8"), "base\n");
		await cleanupWorktree(state, { force: true });
	});
});

test("refuses to remove an unrelated worktree that replaced the managed path", async () => {
	await withRepository(async (root) => {
		const state = createState(await inspectRepository(root), "replaced");
		await createWorktree(state);
		await git(root, "worktree", "remove", "--force", state.worktreePath);
		await git(root, "branch", "-D", state.worktreeBranch);
		await git(root, "worktree", "add", "-b", "unrelated", state.worktreePath);
		await writeFile(join(state.worktreePath, "unrelated.txt"), "must survive\n");

		await assert.rejects(() => cleanupWorktree(state, { force: true }), /ownership|owner/i);
		assert.equal(await readFile(join(state.worktreePath, "unrelated.txt"), "utf8"), "must survive\n");
	});
});

test("rejects a symlinked repo-local .worktrees directory", async () => {
	await withRepository(async (root) => {
		const outside = join(root, "outside");
		await symlink(outside, join(root, ".worktrees"));
		const state = createState(await inspectRepository(root), "unsafe-path");

		await assert.rejects(() => createWorktree(state), /real directory.*symlink/i);
		await assert.rejects(() => git(root, "show-ref", "--verify", `refs/heads/${state.worktreeBranch}`));
	});
});

test("describes uncommitted files and unique commits before discard", async () => {
	await withRepository(async (root) => {
		const state = createState(await inspectRepository(root), "discard-summary");
		await createWorktree(state);
		await writeFile(join(state.worktreePath, "committed.txt"), "committed\n");
		await git(state.worktreePath, "add", "committed.txt");
		await git(state.worktreePath, "commit", "-m", "feat: isolated commit");
		await writeFile(join(state.worktreePath, "untracked.txt"), "untracked\n");

		const summary = await describeDiscard(state);
		assert.match(summary, /1 unique commit/i);
		assert.match(summary, /untracked\.txt/);
		await cleanupWorktree(state, { force: true });
	});
});

test("refuses forced discard when a crash left the rebased head already integrated", async () => {
	await withRepository(async (root) => {
		const state = createState(await inspectRepository(root), "integrated-crash");
		await createWorktree(state);
		await writeFile(join(state.worktreePath, "feature.txt"), "isolated\n");
		state.rebasedHead = await integrateWorktree(state);

		await assert.rejects(() => cleanupWorktree(state, { force: true }), /already.*integrated/i);
		assert.equal(await exists(state.worktreePath), true);
		state.integratedHead = state.rebasedHead;
		await cleanupWorktree(state, { force: false });
	});
});

async function withRepository(run: (root: string) => Promise<void>): Promise<void> {
	const parent = await mkdtemp(join(tmpdir(), "pi-isolate-git-"));
	const root = join(parent, "repo");
	try {
		await git(parent, "init", "-b", "main", root);
		await git(root, "config", "user.name", "Pi Isolate Test");
		await git(root, "config", "user.email", "isolate@example.test");
		await writeFile(join(root, "README.md"), "test\n");
		await git(root, "add", "README.md");
		await git(root, "commit", "-m", "chore: initialize");
		await run(root);
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
}

function createState(repository: Awaited<ReturnType<typeof inspectRepository>>, slug: string): IsolationState {
	return {
		version: 1,
		id: "abcd1234",
		phase: "active",
		task: `Implement ${slug}`,
		createdAt: "2026-07-22T00:00:00.000Z",
		repositoryRoot: repository.root,
		gitCommonDir: repository.commonDir,
		baseBranch: repository.branch,
		baseHead: repository.head,
		sourceCwd: repository.root,
		sourceSessionFile: "/sessions/source.jsonl",
		worktreePath: join(repository.root, ".worktrees", `${slug}-abcd1234`),
		worktreeCwd: join(repository.root, ".worktrees", `${slug}-abcd1234`),
		worktreeBranch: `pi-isolate/${slug}-abcd1234`,
	};
}

async function git(cwd: string, ...args: string[]): Promise<string> {
	const result = await execFileAsync("git", args, { cwd, encoding: "utf8" });
	return result.stdout;
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}
