import { spawn, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

function runHelper(
	helper: "status" | "search" | "sync",
	payload: Record<string, unknown>,
	options: { env?: NodeJS.ProcessEnv } = {},
) {
	const helperPath = path.resolve("agent/extensions/mempalace/helpers", `${helper}.py`);

	return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
		const child = spawn("uv", ["run", helperPath], {
			stdio: ["pipe", "pipe", "pipe"],
			env: { ...process.env, ...options.env },
		});
		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end(JSON.stringify(payload));
	});
}

function getUvPath(): string {
	const result = spawnSync("which", ["uv"], { encoding: "utf8" });
	if (result.status !== 0) {
		throw new Error(result.stderr || "Could not locate uv");
	}
	const uvPath = result.stdout.trim();
	if (!uvPath) {
		throw new Error("Could not locate uv");
	}
	return uvPath;
}

function createUvOnlyBin(root: string): string {
	const binDir = path.join(root, "bin");
	mkdirSync(binDir, { recursive: true });
	symlinkSync(getUvPath(), path.join(binDir, "uv"));
	return binDir;
}

function createToolBin(root: string, script: string): string {
	const binDir = createUvOnlyBin(root);
	const fakeCli = path.join(binDir, "mempalace");
	writeFileSync(fakeCli, script);
	chmodSync(fakeCli, 0o755);
	return binDir;
}

function createMempalaceScript(mode: "success" | "fail"): string {
	return [
		"#!/bin/sh",
		"set -eu",
		"if [ \"$1\" != \"--palace\" ]; then",
		"  echo 'missing palace flag' >&2",
		"  exit 7",
		"fi",
		"palace=$2",
		"shift 2",
		"cmd=$1",
		"shift || true",
		"case \"$cmd\" in",
		"  init)",
		"    project_root=$1",
		"    if [ -n \"${MEMPALACE_LOG_FILE:-}\" ]; then",
		"      printf 'init:%s:%s\\n' \"$project_root\" \"$palace\" >> \"$MEMPALACE_LOG_FILE\"",
		"    fi",
		"    : > \"$project_root/mempalace.yaml\"",
		"    echo \"initialized:$project_root\"",
		"    ;;",
		"  search)",
		"    query=$1",
		"    if [ -n \"${MEMPALACE_LOG_FILE:-}\" ]; then",
		"      printf 'search:%s:%s\\n' \"$query\" \"$palace\" >> \"$MEMPALACE_LOG_FILE\"",
		"    fi",
		"    echo \"searched:$palace:$query\"",
		"    ;;",
		"  mine)",
		"    source=$1",
		"    if [ -n \"${MEMPALACE_LOG_FILE:-}\" ]; then",
		"      printf 'mine:%s:%s\\n' \"$source\" \"$palace\" >> \"$MEMPALACE_LOG_FILE\"",
		"    fi",
		"    if [ \"${MEMPALACE_MINE_MODE:-" + mode + "}\" = \"fail\" ]; then",
		"      echo 'broken index' >&2",
		"      exit 1",
		"    fi",
		"    echo \"indexed:$palace:$source\"",
		"    ;;",
		"  status)",
		"    if [ -n \"${MEMPALACE_LOG_FILE:-}\" ]; then",
		"      printf 'status:%s\\n' \"$palace\" >> \"$MEMPALACE_LOG_FILE\"",
		"    fi",
		"    echo \"status:$palace\"",
		"    ;;",
		"  *)",
		"    echo \"unexpected:$cmd\" >&2",
		"    exit 8",
		"    ;;",
		"esac",
	].join("\n") + "\n";
}

describe("MemPalace helper scripts", () => {
	it("status reports helper availability and project metadata", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-helper-"));
		const projectRoot = path.join(root, "project");
		mkdirSync(projectRoot, { recursive: true });

		const result = await runHelper(
			"status",
			{
				projectRoot,
				projectWing: "wing_repo",
				memoryRoot: path.join(projectRoot, ".pi", "memory", "mempalace"),
				palaceRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "palace"),
				ingestRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "ingest", "pi-session"),
				statePath: path.join(projectRoot, ".pi", "memory", "mempalace", "state.json"),
			},
			{ env: { PATH: createUvOnlyBin(root) } },
		);

		expect(result.code).toBe(0);
		const body = JSON.parse(result.stdout);
		expect(body).toEqual(expect.objectContaining({
			ok: true,
			projectWing: "wing_repo",
			memoryRoot: path.join(projectRoot, ".pi", "memory", "mempalace"),
			stats: {
				ingestFiles: 0,
				indexedItems: 0,
			},
		}));
		expect(body.mempalaceAvailable).toBe(false);
	});

	it("status bootstraps a missing palace once", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-helper-"));
		const projectRoot = path.join(root, "project");
		const logFile = path.join(root, "mempalace.log");
		mkdirSync(projectRoot, { recursive: true });
		const binDir = createToolBin(root, createMempalaceScript("success"));

		const payload = {
			projectRoot,
			projectWing: "wing_repo",
			memoryRoot: path.join(projectRoot, ".pi", "memory", "mempalace"),
			palaceRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "palace"),
			ingestRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "ingest", "pi-session"),
			statePath: path.join(projectRoot, ".pi", "memory", "mempalace", "state.json"),
		};

		const first = await runHelper("status", payload, { env: { PATH: binDir, MEMPALACE_LOG_FILE: logFile } });
		expect(first.code).toBe(0);
		expect(JSON.parse(first.stdout)).toMatchObject({ ok: true, mempalaceAvailable: true });
		expect(readdirSync(projectRoot)).toContain("mempalace.yaml");
		expect(readFileSync(logFile, "utf8")).toContain("init:");

		const second = await runHelper("status", payload, { env: { PATH: binDir, MEMPALACE_LOG_FILE: logFile } });
		expect(second.code).toBe(0);
		const logLines = readFileSync(logFile, "utf8").trim().split(/\r?\n/);
		expect(logLines.filter((line) => line.startsWith("init:")).length).toBe(1);
	});

	it("search fails loudly when the MemPalace CLI is unavailable", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-helper-"));
		const projectRoot = path.join(root, "project");
		mkdirSync(projectRoot, { recursive: true });
		const result = await runHelper(
			"search",
			{
				projectRoot,
				projectWing: "wing_repo",
				memoryRoot: path.join(projectRoot, ".pi", "memory", "mempalace"),
				palaceRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "palace"),
				ingestRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "ingest", "pi-session"),
				statePath: path.join(projectRoot, ".pi", "memory", "mempalace", "state.json"),
				query: "auth decision",
			},
			{ env: { PATH: createUvOnlyBin(root) } },
		);

		expect(result.code).toBe(0);
		const body = JSON.parse(result.stdout);
		expect(body.ok).toBe(false);
		expect(body.code).toBe("MEMPALACE_UNAVAILABLE");
		expect(body.error).toContain("mempalace");
	});

	it("search bootstraps before querying", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-helper-"));
		const projectRoot = path.join(root, "project");
		const logFile = path.join(root, "mempalace.log");
		mkdirSync(projectRoot, { recursive: true });
		const binDir = createToolBin(root, createMempalaceScript("success"));
		const result = await runHelper(
			"search",
			{
				projectRoot,
				projectWing: "wing_repo",
				memoryRoot: path.join(projectRoot, ".pi", "memory", "mempalace"),
				palaceRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "palace"),
				ingestRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "ingest", "pi-session"),
				statePath: path.join(projectRoot, ".pi", "memory", "mempalace", "state.json"),
				query: "auth decision",
			},
			{ env: { PATH: binDir, MEMPALACE_LOG_FILE: logFile } },
		);

		expect(result.code).toBe(0);
		const body = JSON.parse(result.stdout);
		expect(body.ok).toBe(true);
		expect(body.summaryText).toContain("searched:");
		const logLines = readFileSync(logFile, "utf8").trim().split(/\r?\n/);
		expect(logLines[0]).toMatch(/^init:/);
		expect(logLines[1]).toMatch(/^search:/);
	});

	it("sync fails without writing chunk files when the MemPalace CLI is unavailable", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-helper-"));
		const projectRoot = path.join(root, "project");
		mkdirSync(projectRoot, { recursive: true });
		const ingestRoot = path.join(projectRoot, ".pi", "memory", "mempalace", "ingest", "pi-session");
		const result = await runHelper(
			"sync",
			{
				projectRoot,
				projectWing: "wing_repo",
				memoryRoot: path.join(projectRoot, ".pi", "memory", "mempalace"),
				palaceRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "palace"),
				ingestRoot,
				statePath: path.join(projectRoot, ".pi", "memory", "mempalace", "state.json"),
				chunk: {
					createdAt: "2026-04-10T12:34:56.000Z",
					entryStartId: "u1",
					entryEndId: "a1",
					sessionFile: "/sessions/current.jsonl",
					messages: [{ role: "user", text: "Remember this" }],
				},
			},
			{ env: { PATH: createUvOnlyBin(root) } },
		);

		expect(result.code).toBe(0);
		const body = JSON.parse(result.stdout);
		expect(body.ok).toBe(false);
		expect(body.code).toBe("MEMPALACE_UNAVAILABLE");
		expect(() => readdirSync(ingestRoot)).toThrow();
	});

	it("sync bootstraps before mining", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-helper-"));
		const projectRoot = path.join(root, "project");
		const logFile = path.join(root, "mempalace.log");
		mkdirSync(projectRoot, { recursive: true });
		const binDir = createToolBin(root, createMempalaceScript("success"));
		const ingestRoot = path.join(projectRoot, ".pi", "memory", "mempalace", "ingest", "pi-session");
		const result = await runHelper(
			"sync",
			{
				projectRoot,
				projectWing: "wing_repo",
				memoryRoot: path.join(projectRoot, ".pi", "memory", "mempalace"),
				palaceRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "palace"),
				ingestRoot,
				statePath: path.join(projectRoot, ".pi", "memory", "mempalace", "state.json"),
				chunk: {
					createdAt: "2026-04-10T12:34:56.000Z",
					entryStartId: "u1",
					entryEndId: "a1",
					sessionFile: "/sessions/current.jsonl",
					messages: [{ role: "user", text: "Remember this" }],
				},
			},
			{ env: { PATH: binDir, MEMPALACE_LOG_FILE: logFile } },
		);

		expect(result.code).toBe(0);
		const body = JSON.parse(result.stdout);
		expect(body.ok).toBe(true);
		expect(body.saved).toBe(true);
		expect(body.chunkPath).toContain(".json");
		const logLines = readFileSync(logFile, "utf8").trim().split(/\r?\n/);
		expect(logLines[0]).toMatch(/^init:/);
		expect(logLines[1]).toMatch(/^mine:/);
		expect(readdirSync(ingestRoot)).toHaveLength(1);
	});

	it("removes the written chunk when indexing fails", async () => {
		const root = mkdtempSync(path.join(tmpdir(), "mempalace-helper-"));
		const projectRoot = path.join(root, "project");
		const logFile = path.join(root, "mempalace.log");
		mkdirSync(projectRoot, { recursive: true });
		const binDir = createToolBin(root, createMempalaceScript("fail"));
		const ingestRoot = path.join(projectRoot, ".pi", "memory", "mempalace", "ingest", "pi-session");

		const result = await runHelper(
			"sync",
			{
				projectRoot,
				projectWing: "wing_repo",
				memoryRoot: path.join(projectRoot, ".pi", "memory", "mempalace"),
				palaceRoot: path.join(projectRoot, ".pi", "memory", "mempalace", "palace"),
				ingestRoot,
				statePath: path.join(projectRoot, ".pi", "memory", "mempalace", "state.json"),
				chunk: {
					createdAt: "2026-04-10T12:34:56.000Z",
					entryStartId: "u1",
					entryEndId: "a1",
					sessionFile: "/sessions/current.jsonl",
					messages: [{ role: "user", text: "Remember this" }],
				},
			},
			{ env: { PATH: binDir, MEMPALACE_LOG_FILE: logFile, MEMPALACE_MINE_MODE: "fail" } },
		);

		expect(result.code).toBe(0);
		const body = JSON.parse(result.stdout);
		expect(body.ok).toBe(false);
		expect(body.code).toBe("MEMPALACE_SYNC_FAILED");
		expect(readdirSync(ingestRoot)).toEqual([]);
		const logLines = readFileSync(logFile, "utf8").trim().split(/\r?\n/);
		expect(logLines[0]).toMatch(/^init:/);
		expect(logLines[1]).toMatch(/^mine:/);
	});
});
