import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import type { IsolationState } from "./types.ts";

const execFileAsync = promisify(execFile);
const extensionPath = resolve("agent/extensions/isolate/index.ts");

test("print mode exits before another extension slash command can mutate the source worktree", { timeout: 15_000 }, async () => {
	const fixture = await mkdtemp(join(tmpdir(), "pi-isolate-runtime-"));
	try {
		const repositoryRoot = join(fixture, "repo");
		await execFileAsync("git", ["init", "-b", "main", repositoryRoot]);
		const gitCommonDir = join(repositoryRoot, ".git");
		const sourceSessionFile = join(fixture, "source.jsonl");
		const isolatedSessionFile = join(fixture, "isolated.jsonl");
		const mutationPath = join(fixture, "MUTATED");
		const id = "job12345";
		const state: IsolationState = {
			version: 1,
			id,
			phase: "active",
			task: "Runtime guard test",
			createdAt: "2026-07-22T00:00:00.000Z",
			repositoryRoot,
			gitCommonDir,
			baseBranch: "main",
			baseHead: "deadbeef",
			sourceCwd: repositoryRoot,
			sourceSessionFile,
			worktreePath: join(repositoryRoot, ".worktrees", `runtime-${id}`),
			worktreeCwd: join(repositoryRoot, ".worktrees", `runtime-${id}`),
			worktreeBranch: `pi-isolate/runtime-${id}`,
			isolatedSessionFile,
		};

		await mkdir(dirname(join(gitCommonDir, "pi-isolate", "state.json")), { recursive: true });
		await writeFile(join(gitCommonDir, "pi-isolate", "state.json"), `${JSON.stringify(state)}\n`);
		await writeFile(sourceSessionFile, [
			JSON.stringify({
				type: "session",
				version: 3,
				id: "11111111-1111-7111-8111-111111111111",
				timestamp: "2026-07-22T00:00:00.000Z",
				cwd: repositoryRoot,
			}),
			JSON.stringify({
				type: "custom",
				customType: "pi-isolate-job",
				data: { version: 1, id, gitCommonDir, status: "active", state },
				id: "pointer1",
				parentId: null,
				timestamp: "2026-07-22T00:00:01.000Z",
			}),
			"",
		].join("\n"));

		const mutatingExtension = join(fixture, "mutate.ts");
		await writeFile(mutatingExtension, [
			'import { writeFileSync } from "node:fs";',
			"export default function mutate(pi: any) {",
			'  pi.registerCommand("mutate", {',
			'    description: "must not run",',
			`    handler: async () => writeFileSync(${JSON.stringify(mutationPath)}, "unsafe")`,
			"  });",
			"}",
		].join("\n"));

		const exitCode = await new Promise<number | null>((resolveExit, rejectExit) => {
			const child = spawn("pi", [
				"--print",
				"--no-extensions",
				"--no-skills",
				"--no-prompt-templates",
				"--no-context-files",
				"--session",
				sourceSessionFile,
				"-e",
				extensionPath,
				"-e",
				mutatingExtension,
				"/mutate",
			], { stdio: "ignore" });
			child.once("error", rejectExit);
			child.once("exit", resolveExit);
		});

		assert.equal(exitCode, 1);
		await assert.rejects(() => access(mutationPath), /ENOENT/);
	} finally {
		await rm(fixture, { recursive: true, force: true });
	}
});
