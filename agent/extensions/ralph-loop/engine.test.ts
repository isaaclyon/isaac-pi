import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeAllRalphDbs, getRalphDb } from "./db.js";
import { RalphStore } from "./store.js";
import { startRalphRun } from "./engine.js";
import type { RalphRunConfig } from "./types.js";

function config(): RalphRunConfig {
	return {
		task: "Do thing",
		maxLoops: 1,
		budget: { contextThresholdPercent: 50, maxAssistantTurns: null, maxToolCalls: null },
		success: { mode: "quantitative", checks: [{ command: "echo ok" }] },
		runner: { cwd: ".", model: null, tools: null, tmuxSessionPrefix: "ralph", modelContextWindowTokens: 90_000 },
	};
}

describe("startRalphRun", () => {
	afterEach(() => {
		closeAllRalphDbs();
	});

	it("returns run id immediately and executes supervisor in background", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-engine-"));
		const store = new RalphStore(getRalphDb(join(dir, "ralph.sqlite")));
		const executeLoop = vi.fn(async () => ({
			state: "completed" as const,
			triggerReason: "context_threshold",
			summary: "done",
			artifacts: {},
			nextPrompt: "continue",
		}));

		const run = startRalphRun({ store, config: config(), executeLoop });

		expect(run.runId).toBeTruthy();
		expect(store.getRun(run.runId)?.state).toBe("running");

		await run.completion;

		expect(executeLoop).toHaveBeenCalledTimes(1);
		expect(store.getRun(run.runId)?.state).toBe("succeeded");

		rmSync(dir, { recursive: true, force: true });
	});
});
