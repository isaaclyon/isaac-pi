import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createDefaultSnapshot, decideResumePlan, invalidateForResume } from "./auto.ts";
import { exportPatchArtifact, syncWorkingTree } from "./repair-runner.ts";

async function createRepo(): Promise<{ dir: string; head: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-int-"));
	await run("git", ["init"], dir);
	await run("git", ["config", "user.email", "test@example.com"], dir);
	await run("git", ["config", "user.name", "Test User"], dir);
	await fs.writeFile(path.join(dir, "app.txt"), "before\n", "utf8");
	await run("git", ["add", "app.txt"], dir);
	await run("git", ["commit", "-m", "init"], dir);
	return { dir, head: (await stdout("git", ["rev-parse", "HEAD"], dir)).trim() };
}

test("integration flow imports a repair patch, commits it, and invalidates downstream state", async () => {
	const { dir, head } = await createRepo();
	const worktree = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-worktree-"));
	await run("git", ["worktree", "add", "--detach", worktree, "HEAD"], dir);
	await syncWorkingTree(dir, worktree);
	await fs.writeFile(path.join(worktree, "app.txt"), "after\n", "utf8");
	await fs.writeFile(path.join(worktree, "new.txt"), "created\n", "utf8");

	const patchFile = path.join(worktree, "repair.patch");
	const patch = await exportPatchArtifact(worktree, patchFile);
	assert.match(patch, /new.txt/);
	await run("git", ["apply", "--index", "--3way", patchFile], dir);
	await run("git", ["commit", "-m", "fix: import repair"], dir);
	const newHead = (await stdout("git", ["rev-parse", "HEAD"], dir)).trim();
	assert.notEqual(newHead, head);

	const state = createDefaultSnapshot(true);
	state.pr = { number: 1, title: "PR", url: "https://example.test/pr/1", headRefName: "feat/x", headRefOid: head };
	for (const step of state.steps) step.status = "done";
	state.checks = [{ name: "ci", status: "failed" } as any];
	const resumed = invalidateForResume(state, decideResumePlan("ci", true));
	assert.equal(resumed.auto.resumeFromCheckpoint, "push");
	assert.equal(resumed.pr, undefined);
	assert.deepEqual(resumed.checks, []);
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
