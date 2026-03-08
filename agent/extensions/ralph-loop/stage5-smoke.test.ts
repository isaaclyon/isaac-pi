import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAllRalphDbs, getRalphDb } from "./db.js";
import { RalphStore } from "./store.js";
import { startRalphRun } from "./engine.js";
import type { RalphRunConfig } from "./types.js";

describe("ralph-loop stage5 smoke", () => {
	afterEach(() => {
		closeAllRalphDbs();
	});

	it("runs a lightweight end-to-end orchestration path and persists status artifacts", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-stage5-smoke-"));
		const dbPath = join(dir, "ralph.sqlite");
		const store = new RalphStore(getRalphDb(dbPath));

		const config: RalphRunConfig = {
			task: "Stage5 smoke: validate Ralph orchestration",
			maxLoops: 2,
			budget: { contextThresholdPercent: 50, maxAssistantTurns: null, maxToolCalls: null },
			success: { mode: "quantitative", checks: [{ command: "echo ok", stdoutIncludes: "ok" }] },
			runner: { cwd: ".", model: null, tools: null, tmuxSessionPrefix: "ralph", modelContextWindowTokens: 200_000 },
		};

		const run = startRalphRun({
			store,
			config,
			executeLoop: async ({ loopNumber }) => ({
				state: "completed",
				triggerReason: "context_threshold",
				summary: `Smoke loop ${loopNumber} completed`,
				artifacts: { smoke: true },
				nextPrompt: "continue",
			}),
		});

		await run.completion;

		const persisted = store.getRun(run.runId);
		const latestLoop = store.getLatestLoop(run.runId);
		const latestEval = store.getLatestEvent(run.runId, "success_evaluated");

		expect(persisted?.state).toBe("succeeded");
		expect(persisted?.activeLoop).toBe(1);
		expect(latestLoop?.state).toBe("completed");
		expect(latestLoop?.triggerReason).toBe("context_threshold");
		expect(latestEval).toBeTruthy();
		expect(store.listRuns(10).length).toBe(1);

		rmSync(dir, { recursive: true, force: true });
	});
});
