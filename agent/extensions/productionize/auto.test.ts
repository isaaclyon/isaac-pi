import assert from "node:assert/strict";
import test from "node:test";
import {
	createDefaultSnapshot,
	parseProductionizeArgs,
	prepareStateForModelRun,
	reconstructAutoState,
	serializeStateEntry,
} from "./auto.ts";

test("/productionize args parse auto and single-stage manual targets", () => {
	assert.deepEqual(parseProductionizeArgs(""), { auto: false });
	assert.deepEqual(parseProductionizeArgs("auto"), { auto: true });
	assert.deepEqual(parseProductionizeArgs("AUTO"), { auto: true });
	assert.deepEqual(parseProductionizeArgs("commit"), { auto: false, targetStep: "commit" });
	assert.deepEqual(parseProductionizeArgs("PR"), { auto: false, targetStep: "pr" });
	assert.match(parseProductionizeArgs("later").usageError ?? "", /Usage/);
	assert.match(parseProductionizeArgs("auto commit").usageError ?? "", /Usage/);
});

test("prepareStateForModelRun rewinds late failures through commit and clears stale failure state", () => {
	const state = createDefaultSnapshot(true);
	state.outcome = "failed";
	state.status = "Productionize failed during CI Checks.";
	state.failure = { step: "CI Checks", message: "Tests failed" };
	state.cancelRequested = true;
	state.auto.activeCheckpoint = "ci";
	state.auto.resumeFromCheckpoint = "ci";
	state.auto.startFromCheckpoint = "branch";
	state.auto.stopAfterCheckpoint = "ci";

	const next = prepareStateForModelRun(state);

	assert.equal(next.outcome, "running");
	assert.equal(next.status, "Resuming productionize from commit...");
	assert.equal(next.failure, undefined);
	assert.equal(next.cancelRequested, false);
	assert.equal(next.auto.enabled, true);
	assert.equal(next.auto.activeCheckpoint, undefined);
	assert.equal(next.auto.resumeFromCheckpoint, "commit");
	assert.equal(next.auto.startFromCheckpoint, "branch");
	assert.equal(next.auto.stopAfterCheckpoint, "ci");
});

test("prepareStateForModelRun keeps branch and return resumes narrow", () => {
	const branchFailure = createDefaultSnapshot(true);
	branchFailure.auto.resumeFromCheckpoint = "branch";
	assert.equal(prepareStateForModelRun(branchFailure).auto.resumeFromCheckpoint, "branch");

	const returnFailure = createDefaultSnapshot(true);
	returnFailure.auto.resumeFromCheckpoint = "return";
	assert.equal(prepareStateForModelRun(returnFailure).auto.resumeFromCheckpoint, "return");
});

test("reconstruction restores latest auto run state", () => {
	const state = createDefaultSnapshot(true) as any;
	state.auto.startTimestamp = "2026-06-04T00:00:00.000Z";
	state.auto.activeCheckpoint = "ci";
	state.auto.resumeFromCheckpoint = "ci";
	state.auto.startFromCheckpoint = "branch";
	state.auto.stopAfterCheckpoint = "ci";
	state.auto.currentRepair = { stepId: "ci" };
	state.fixInstruction = "legacy fix text";
	state.branch = "feat/test";
	state.status = "Polling GitHub checks...";

	const restored = reconstructAutoState([
		{ type: "custom", customType: "productionize-auto-state", data: serializeStateEntry(state, "2026-06-04T00:00:00.000Z") },
	]);

	assert.equal(restored.state?.auto.reconstructed, true);
	assert.equal(restored.state?.auto.enabled, true);
	assert.equal(restored.state?.auto.activeCheckpoint, "ci");
	assert.equal(restored.state?.auto.resumeFromCheckpoint, "ci");
	assert.equal(restored.state?.auto.startFromCheckpoint, "branch");
	assert.equal(restored.state?.auto.stopAfterCheckpoint, "ci");
	assert.equal(restored.state?.branch, "feat/test");
	assert.equal("currentRepair" in (restored.state?.auto ?? {}), false);
	assert.equal("fixInstruction" in (restored.state ?? {}), false);
});
