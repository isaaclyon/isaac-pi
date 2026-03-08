import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAllRalphDbs, getRalphDb } from "./db.js";
import { RalphStore } from "./store.js";
import type { RalphRunConfig } from "./types.js";

function runConfig(task: string): RalphRunConfig {
	return {
		task,
		maxLoops: 5,
		budget: { contextThresholdPercent: 50, maxAssistantTurns: 5, maxToolCalls: 20 },
		success: { mode: "deterministic-tdd", mustFail: ["pytest tests/red.py"], mustPass: ["pytest tests/green.py"] },
		runner: { cwd: ".", model: null, tools: null, tmuxSessionPrefix: "ralph", modelContextWindowTokens: 200_000 },
	};
}

describe("ralph-loop store", () => {
	afterEach(() => {
		closeAllRalphDbs();
	});

	it("creates run, loop, checkpoint, and events", () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-store-"));
		const dbPath = join(dir, "ralph.sqlite");
		const store = new RalphStore(getRalphDb(dbPath));
		const now = Date.now();

		const run = store.createRun({
			runId: "run_1",
			task: "Implement parser",
			maxLoops: 5,
			config: runConfig("Implement parser"),
			createdAt: now,
		});
		expect(run.runId).toBe("run_1");
		expect(run.state).toBe("running");

		const loop = store.startLoop({ runId: "run_1", loopNumber: 1, startedAt: now + 1 });
		expect(loop.loopNumber).toBe(1);
		expect(loop.state).toBe("running");

		store.completeLoop({
			runId: "run_1",
			loopNumber: 1,
			state: "completed",
			triggerReason: "context_threshold",
			summary: "Implemented core parser",
			checkpointJson: JSON.stringify({ files: ["parser.ts"] }),
			endedAt: now + 2,
		});

		store.saveCheckpoint({
			runId: "run_1",
			loopNumber: 1,
			triggerReason: "context_threshold",
			summary: "Checkpoint summary",
			artifactsJson: JSON.stringify({ tests: ["pytest tests/parser.py"] }),
			nextPrompt: "Continue from parser baseline",
			createdAt: now + 3,
		});

		store.appendEvent({
			runId: "run_1",
			loopId: loop.loopId,
			eventType: "loop_completed",
			payloadJson: JSON.stringify({ ok: true }),
			createdAt: now + 4,
		});

		store.updateRunState("run_1", "succeeded", now + 5);

		const updated = store.getRun("run_1");
		expect(updated?.state).toBe("succeeded");
		expect(updated?.activeLoop).toBe(1);

		const listed = store.listRuns();
		expect(listed.length).toBe(1);
		expect(listed[0].runId).toBe("run_1");

		rmSync(dir, { recursive: true, force: true });
	});

	it("persists run and loop records across store re-initialization", () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-store-persist-"));
		const dbPath = join(dir, "ralph.sqlite");
		const now = Date.now();

		const store1 = new RalphStore(getRalphDb(dbPath));
		store1.createRun({
			runId: "run_persist",
			task: "Persist me",
			maxLoops: 2,
			config: runConfig("Persist me"),
			createdAt: now,
		});
		store1.startLoop({ runId: "run_persist", loopNumber: 1, startedAt: now + 1 });
		store1.completeLoop({
			runId: "run_persist",
			loopNumber: 1,
			state: "completed",
			triggerReason: "context_threshold",
			summary: "loop one",
			checkpointJson: JSON.stringify({ ok: true }),
			endedAt: now + 2,
		});

		closeAllRalphDbs();

		const store2 = new RalphStore(getRalphDb(dbPath));
		expect(store2.getRun("run_persist")?.task).toBe("Persist me");
		expect(store2.getRun("run_persist")?.activeLoop).toBe(1);
		expect(store2.getLoop("run_persist", 1)?.state).toBe("completed");

		rmSync(dir, { recursive: true, force: true });
	});
});
