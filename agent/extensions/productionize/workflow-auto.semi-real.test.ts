import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createDefaultSnapshot, decideResumePlan, invalidateForResume } from "./auto.ts";
import { exportPatchArtifact, syncWorkingTree } from "./repair-runner.ts";

test("semi-real repo flow preserves create/delete diffs and resets downstream workflow state", async () => {
	const repo = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-semi-"));
	await run("git", ["init"], repo);
	await run("git", ["config", "user.email", "test@example.com"], repo);
	await run("git", ["config", "user.name", "Test User"], repo);
	await fs.writeFile(path.join(repo, "keep.txt"), "keep\n", "utf8");
	await fs.writeFile(path.join(repo, "delete.txt"), "delete\n", "utf8");
	await run("git", ["add", "."], repo);
	await run("git", ["commit", "-m", "init"], repo);
	const oldHead = (await stdout("git", ["rev-parse", "HEAD"], repo)).trim();

	const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-semi-worktree-"));
	await run("git", ["worktree", "add", "--detach", worktree, "HEAD"], repo);
	await syncWorkingTree(repo, worktree);
	await fs.rm(path.join(worktree, "delete.txt"));
	await fs.writeFile(path.join(worktree, "create.txt"), "create\n", "utf8");
	const patchFile = path.join(worktree, "repair.patch");
	const patch = await exportPatchArtifact(worktree, patchFile);
	assert.match(patch, /create.txt/);
	assert.match(patch, /delete.txt/);

	await run("git", ["apply", "--index", "--3way", patchFile], repo);
	await run("git", ["commit", "-m", "fix: repair"], repo);
	const newHead = (await stdout("git", ["rev-parse", "HEAD"], repo)).trim();
	assert.notEqual(newHead, oldHead);

	const state = createDefaultSnapshot(true);
	state.pr = { number: 9, title: "PR", url: "https://example.test/pr/9", headRefName: "feat/x", headRefOid: oldHead };
	state.checks = [{ name: "build", status: "failed" } as any];
	for (const step of state.steps) step.status = "done";
	const resumed = invalidateForResume(state, decideResumePlan("merge", true));
	assert.equal(resumed.auto.resumeFromCheckpoint, "push");
	assert.equal(resumed.pr, undefined);
	assert.deepEqual(resumed.checks, []);
	assert.equal(resumed.steps.find((step) => step.id === "return")?.status, "pending");
});

async function run(command: string, args: string[], cwd: string): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const proc = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let stderr = "";
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("close", (code) => {
			if ((code ?? 0) === 0) resolve();
			else reject(new Error(stderr || `${command} ${args.join(" ")} failed`));
		});
		proc.on("error", reject);
	});
}

async function stdout(command: string, args: string[], cwd: string): Promise<string> {
	return await new Promise<string>((resolve, reject) => {
		const proc = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
		let out = "";
		let err = "";
		proc.stdout.on("data", (chunk) => {
			out += chunk.toString();
		});
		proc.stderr.on("data", (chunk) => {
			err += chunk.toString();
		});
		proc.on("close", (code) => {
			if ((code ?? 0) === 0) resolve(out);
			else reject(new Error(err || `${command} ${args.join(" ")} failed`));
		});
		proc.on("error", reject);
	});
}
