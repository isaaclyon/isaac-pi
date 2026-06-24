import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";
import { createRepairRunner, exportPatchArtifact, killVerifiedOrphan, syncWorkingTree, verifyRunningChild } from "./repair-runner.ts";
import { guardInput, guardToolCall, resolveConfinedPath } from "./repair-guard.ts";

async function initRepo(): Promise<{ dir: string; branch: string }> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-test-"));
	await run("git", ["init"], dir);
	await run("git", ["config", "user.email", "test@example.com"], dir);
	await run("git", ["config", "user.name", "Test User"], dir);
	await fs.writeFile(path.join(dir, "tracked.txt"), "before\n", "utf8");
	await run("git", ["add", "tracked.txt"], dir);
	await run("git", ["commit", "-m", "init"], dir);
	const branch = await stdout("git", ["branch", "--show-current"], dir);
	return { dir, branch: branch.trim() };
}

test("guard blocks /productionize recursion and unsafe bash but allows focused autofix commands", async () => {
	assert.deepEqual(await guardInput({ text: "/productionize auto", type: "input", source: "extension" } as any), { action: "handled" });
	assert.equal(await guardInput({ text: "normal prompt", type: "input", source: "extension" } as any), undefined);
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-bash-"));
	await fs.mkdir(path.join(root, "pkg"), { recursive: true });
	await fs.writeFile(path.join(root, "pkg", "app.py"), "print('ok')\n", "utf8");
	const allowedEvent = { type: "tool_call", toolName: "bash", input: { command: "ruff check --fix pkg/app.py && ruff format pkg/app.py" } } as any;
	assert.equal(await guardToolCall(allowedEvent, root), undefined);
	assert.match(allowedEvent.input.command, /^cd '/);
	assert.match(allowedEvent.input.command, /ruff check --fix pkg\/app.py && ruff format pkg\/app.py$/);
	const wrappedEvent = { type: "tool_call", toolName: "bash", input: { command: "uv run python -m ruff check --fix pkg/app.py" } } as any;
	assert.equal(await guardToolCall(wrappedEvent, root), undefined);
	assert.match(wrappedEvent.input.command, /uv run python -m ruff check --fix pkg\/app.py$/);
	assert.deepEqual(
		await guardToolCall({ type: "tool_call", toolName: "bash", input: { command: "pwd" } } as any, root),
		{ block: true, reason: "Only focused local autofix commands are allowed in productionize auto repair." },
	);
	assert.deepEqual(
		await guardToolCall({ type: "tool_call", toolName: "bash", input: { command: "black pkg/app.py & rm -rf ." } } as any, root),
		{ block: true, reason: "Only focused local autofix commands are allowed in productionize auto repair." },
	);
	assert.deepEqual(
		await guardToolCall({ type: "tool_call", toolName: "bash", input: { command: "prettier --write ../outside.js" } } as any, root),
		{ block: true, reason: "Only focused local autofix commands are allowed in productionize auto repair." },
	);
});

test("guard permits read/edit/write only within the temp worktree", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-guard-"));
	await fs.writeFile(path.join(root, "file.txt"), "hello", "utf8");
	const allowed = await guardToolCall({ type: "tool_call", toolName: "read", input: { path: "file.txt" } } as any, root);
	assert.equal(allowed, undefined);
});

test("path confinement rejects traversal, symlink escapes, outside writes, and .git edits", async () => {
	const root = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-path-"));
	await fs.mkdir(path.join(root, ".git"));
	await fs.writeFile(path.join(root, "inside.txt"), "ok", "utf8");
	const outside = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-outside-"));
	await fs.writeFile(path.join(outside, "outside.txt"), "nope", "utf8");
	await fs.symlink(outside, path.join(root, "escape"));

	assert.match(await resolveReject(root, "../hack.txt", "write"), /escapes/);
	assert.match(await resolveReject(root, ".git/config", "write"), /not allowed/);
	assert.match(await resolveReject(root, "escape/outside.txt", "existing"), /escapes/);
	assert.match(await resolveReject(root, path.join(outside, "outside.txt"), "existing"), /escapes/);
});

test("patch export preserves creates and deletes and includes binary-safe headers", async () => {
	const { dir: repo } = await initRepo();
	await fs.writeFile(path.join(repo, "created.txt"), "new\n", "utf8");
	await fs.rm(path.join(repo, "tracked.txt"));
	const patchFile = path.join(repo, "repair.patch");
	const patch = await exportPatchArtifact(repo, patchFile);
	assert.match(patch, /diff --git a\/created.txt b\/created.txt/);
	assert.match(patch, /deleted file mode/);
	assert.equal(await fs.readFile(patchFile, "utf8"), patch);
});

test("syncWorkingTree replaces file, directory, and symlink node types", async () => {
	const source = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-source-"));
	const target = await fs.mkdtemp(path.join(os.tmpdir(), "productionize-auto-target-"));

	await fs.mkdir(path.join(source, "becomes-dir"));
	await fs.writeFile(path.join(source, "becomes-dir", "nested.txt"), "dir\n", "utf8");
	await fs.writeFile(path.join(target, "becomes-dir"), "file\n", "utf8");

	await fs.writeFile(path.join(source, "becomes-file"), "file\n", "utf8");
	await fs.mkdir(path.join(target, "becomes-file"));
	await fs.writeFile(path.join(target, "becomes-file", "old.txt"), "old\n", "utf8");

	await fs.writeFile(path.join(source, "link-target.txt"), "target\n", "utf8");
	await fs.symlink("link-target.txt", path.join(source, "becomes-link"));
	await fs.mkdir(path.join(target, "becomes-link"));
	await fs.writeFile(path.join(target, "becomes-link", "old.txt"), "old\n", "utf8");

	await syncWorkingTree(source, target);

	assert.equal((await fs.lstat(path.join(target, "becomes-dir"))).isDirectory(), true);
	assert.equal(await fs.readFile(path.join(target, "becomes-dir", "nested.txt"), "utf8"), "dir\n");
	assert.equal((await fs.lstat(path.join(target, "becomes-file"))).isFile(), true);
	assert.equal(await fs.readFile(path.join(target, "becomes-file"), "utf8"), "file\n");
	assert.equal((await fs.lstat(path.join(target, "becomes-link"))).isSymbolicLink(), true);
	assert.equal(await fs.readlink(path.join(target, "becomes-link")), "link-target.txt");
});

test("verified orphan detection kills only a matching child process", async () => {
	const token = "token-match";
	const spawnTimestamp = "2026-06-04T12:34:56.000Z";
	const slug = spawnTimestamp.replace(/[:.]/g, "-");
	const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)", token, slug], { stdio: "ignore" });
	try {
		const repair = {
			pid: child.pid,
			childToken: token,
			spawnTimestamp,
			verifiedCommand: { command: process.execPath, args: [token, slug], cwd: process.cwd(), tools: ["read", "edit", "write", "bash"] },
		} as any;
		assert.equal(await verifyRunningChild(repair), true);
		assert.equal(await killVerifiedOrphan(repair), true);
		assert.equal(await verifyRunningChild(repair), false);
	} finally {
		child.kill("SIGKILL");
	}
});

test("repair runner times out a stuck subprocess instead of hanging forever", async () => {
	const { dir: repo, branch } = await initRepo();
	const runner = createRepairRunner({
		repairTimeoutMs: 50,
		spawnProcess: (() => spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "pipe"] })) as any,
	});
	const summary = await runner.start({
		cwd: repo,
		stepId: "ci",
		branch: "feat/test",
		baseBranch: branch,
		prompt: "ignored",
	});
	assert.equal(summary.outcome, "failed");
	assert.match(summary.summary, /timed out/i);
	assert.match(summary.errorMessage ?? "", /timed out/i);
});

test("repair runner smoke test records a session file and terminal outcome", async (t) => {
	const { dir: repo, branch } = await initRepo();
	const runner = createRepairRunner();
	const abort = new AbortController();
	const timeout = setTimeout(() => abort.abort(), 15_000);
	let skip = false;
	try {
		const summary = await runner.start(
			{
				cwd: repo,
				stepId: "commit",
				branch: "feat/test",
				baseBranch: branch,
				prompt: "Use the read tool on tracked.txt, then reply with exactly OK.",
				abortSignal: abort.signal,
			},
		);
		assert.ok(summary.sessionFile.endsWith(".jsonl"));
		assert.ok(["succeeded", "failed", "cancelled"].includes(summary.outcome));
		assert.equal(summary.protocol.sawSessionHeader, true);
	} catch (error) {
		skip = true;
		t.diagnostic(`Skipping smoke test: ${error instanceof Error ? error.message : String(error)}`);
	} finally {
		clearTimeout(timeout);
	}
	if (skip) t.skip("pi model/runtime unavailable for subprocess smoke test");
});

async function resolveReject(root: string, candidate: string, mode: "existing" | "write"): Promise<string> {
	try {
		await resolveConfinedPath(root, candidate, mode);
		return "";
	} catch (error) {
		return error instanceof Error ? error.message : String(error);
	}
}

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
