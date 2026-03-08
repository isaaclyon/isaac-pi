import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRalphDb, closeAllRalphDbs } from "./db.js";
import { RalphStore } from "./store.js";
import { runRalphSupervisor } from "./supervisor.js";
import type { RalphRunConfig } from "./types.js";

function makeConfig(): RalphRunConfig {
	return {
		task: "Build ralph loop",
		maxLoops: 2,
		budget: { contextThresholdPercent: 50, maxAssistantTurns: 3, maxToolCalls: 6 },
		success: { mode: "quantitative", checks: [{ command: "false" }] },
		runner: { cwd: ".", model: null, tools: null, tmuxSessionPrefix: "ralph", modelContextWindowTokens: 200_000 },
	};
}

describe("runRalphSupervisor", () => {
	afterEach(() => {
		closeAllRalphDbs();
	});

	it("runs loops and writes checkpoints until max loop bound", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-supervisor-"));
		const dbPath = join(dir, "ralph.sqlite");
		const store = new RalphStore(getRalphDb(dbPath));
		const runId = "run_stage2";
		const config = makeConfig();
		const now = Date.now();

		store.createRun({
			runId,
			task: config.task,
			maxLoops: config.maxLoops,
			config,
			createdAt: now,
		});

		const loopCalls: number[] = [];
		await runRalphSupervisor({
			store,
			runId,
			config,
			executeLoop: async ({ loopNumber }) => {
				loopCalls.push(loopNumber);
				return {
					triggerReason: "context_threshold",
					summary: `Loop ${loopNumber} summary`,
					artifacts: { files: [`file-${loopNumber}.ts`] },
					nextPrompt: `Continue from loop ${loopNumber}`,
					state: "completed",
				};
			},
		});

		expect(loopCalls).toEqual([1, 2]);

		const run = store.getRun(runId);
		expect(run?.state).toBe("max_loops_reached");
		expect(run?.activeLoop).toBe(2);

		const loop1 = store.getLoop(runId, 1);
		const loop2 = store.getLoop(runId, 2);
		expect(loop1?.checkpointJson).toContain("file-1.ts");
		expect(loop2?.checkpointJson).toContain("file-2.ts");

		rmSync(dir, { recursive: true, force: true });
	});

	it("marks run succeeded immediately when success checks pass", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-supervisor-success-"));
		const dbPath = join(dir, "ralph.sqlite");
		const store = new RalphStore(getRalphDb(dbPath));
		const runId = "run_success";
		const config: RalphRunConfig = {
			...makeConfig(),
			maxLoops: 5,
			success: { mode: "quantitative", checks: [{ command: "echo ok" }] },
		};
		const now = Date.now();

		store.createRun({
			runId,
			task: config.task,
			maxLoops: config.maxLoops,
			config,
			createdAt: now,
		});

		const loopCalls: number[] = [];
		await runRalphSupervisor({
			store,
			runId,
			config,
			executeLoop: async ({ loopNumber }) => {
				loopCalls.push(loopNumber);
				return {
					triggerReason: "context_threshold",
					summary: `Loop ${loopNumber} summary`,
					artifacts: { files: [`file-${loopNumber}.ts`] },
					nextPrompt: `Continue from loop ${loopNumber}`,
					state: "completed",
				};
			},
		});

		expect(loopCalls).toEqual([1]);
		expect(store.getRun(runId)?.state).toBe("succeeded");

		rmSync(dir, { recursive: true, force: true });
	});
});
