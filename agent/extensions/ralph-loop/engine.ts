import { randomUUID } from "node:crypto";
import { executeLoopWithTmux } from "./loop-executor.js";
import { runRalphSupervisor, type RalphExecuteLoop } from "./supervisor.js";
import type { RalphStore } from "./store.js";
import type { RalphRunConfig } from "./types.js";

export function startRalphRun(input: {
	store: RalphStore;
	config: RalphRunConfig;
	executeLoop?: RalphExecuteLoop;
	signal?: AbortSignal;
}): { runId: string; completion: Promise<void> } {
	const runId = `ralph_${randomUUID()}`;
	const now = Date.now();

	input.store.createRun({
		runId,
		task: input.config.task,
		maxLoops: input.config.maxLoops,
		config: input.config,
		createdAt: now,
	});

	const executeLoop: RalphExecuteLoop =
		input.executeLoop
		?? ((loopInput) =>
			executeLoopWithTmux({
				runId: loopInput.runId,
				loopNumber: loopInput.loopNumber,
				config: loopInput.config,
				previousCheckpoint: loopInput.previousCheckpoint,
				modelContextWindowTokens: loopInput.config.runner.modelContextWindowTokens,
				signal: loopInput.signal,
			}));

	const completion = runRalphSupervisor({
		store: input.store,
		runId,
		config: input.config,
		executeLoop,
		signal: input.signal,
	});

	return { runId, completion };
}
