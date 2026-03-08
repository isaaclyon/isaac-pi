import assert from "node:assert/strict";

import {
	buildSweepSummary,
	computeEffortStats,
	evaluateSweepMeanGate,
	groupRunsByEffort,
} from "./stage4-live-eval-sweep-core.ts";

function testGroupRunsByEffort() {
	const grouped = groupRunsByEffort(
		[
			{ effort: "low", runNumber: 1, recall: 1, gateOk: true },
			{ effort: "medium", runNumber: 1, recall: 1 / 3, gateOk: false },
			{ effort: "low", runNumber: 2, recall: 2 / 3, gateOk: true },
		],
		["low", "medium", "high"],
	);

	assert.equal(grouped.low.length, 2);
	assert.equal(grouped.medium.length, 1);
	assert.equal(grouped.high.length, 0);
}

function testComputeEffortStats() {
	const grouped = groupRunsByEffort(
		[
			{ effort: "low", runNumber: 1, recall: 1, gateOk: true, retrieval: { mode: "retrieval-aware", used: true, toolCallCount: 2, toolNames: ["lcm_grep"], steps: 2, toolErrorCount: 0 } },
			{ effort: "low", runNumber: 2, recall: 2 / 3, gateOk: true, retrieval: { mode: "retrieval-aware", used: false, toolCallCount: 0, toolNames: [], steps: 1, toolErrorCount: 0 } },
			{ effort: "low", runNumber: 3, recall: 1 / 3, gateOk: false, retrieval: { mode: "retrieval-aware", used: true, toolCallCount: 1, toolNames: ["lcm_describe"], steps: 2, toolErrorCount: 1 } },
			{ effort: "medium", runNumber: 1, recall: 1 / 3, gateOk: false, retrieval: { mode: "summary-only", used: false, toolCallCount: 0, toolNames: [], steps: 1, toolErrorCount: 0 } },
			{ effort: "medium", runNumber: 2, recall: 0, gateOk: false, executionError: "parse failure", retrieval: { mode: "summary-only", used: false, toolCallCount: 0, toolNames: [], steps: 1, toolErrorCount: 0 } },
		],
		["low", "medium"],
	);
	const stats = computeEffortStats(grouped, 2 / 3);
	assert.equal(stats.length, 2);

	const low = stats.find((s) => s.effort === "low");
	assert.ok(low);
	assert.equal(low.runCount, 3);
	assert.equal(low.passCount, 2);
	assert.equal(low.failCount, 1);
	assert.equal(low.minRecall, 1 / 3);
	assert.equal(low.maxRecall, 1);
	assert.equal(low.meanRecall, 2 / 3);
	assert.equal(low.retrievalUsedCount, 2);
	assert.equal(low.retrievalUsageRate, 2 / 3);
	assert.equal(low.retrievalToolCallCount, 3);
	assert.equal(low.retrievalToolErrorCount, 1);
	assert.deepEqual(low.retrievalToolNames.sort(), ["lcm_describe", "lcm_grep"]);

	const medium = stats.find((s) => s.effort === "medium");
	assert.ok(medium);
	assert.equal(medium.runCount, 2);
	assert.equal(medium.passCount, 0);
	assert.equal(medium.failCount, 2);
	assert.equal(medium.meanRecall, 1 / 6);
	assert.equal(medium.errorCount, 1);
	assert.equal(medium.retrievalUsedCount, 0);
	assert.equal(medium.retrievalToolCallCount, 0);
}

function testEvaluateSweepMeanGate() {
	const pass = evaluateSweepMeanGate(
		[
			{ effort: "low", runCount: 5, meanRecall: 0.8, minRecall: 0.66, maxRecall: 1, passCount: 4, failCount: 1, errorCount: 0 },
			{ effort: "medium", runCount: 5, meanRecall: 0.67, minRecall: 0.33, maxRecall: 1, passCount: 3, failCount: 2, errorCount: 0 },
		],
		0.67,
	);
	assert.equal(pass.ok, true);
	assert.deepEqual(pass.reasons, []);

	const fail = evaluateSweepMeanGate(
		[
			{ effort: "low", runCount: 5, meanRecall: 0.61, minRecall: 0.33, maxRecall: 1, passCount: 2, failCount: 3, errorCount: 0 },
			{ effort: "medium", runCount: 5, meanRecall: 0.72, minRecall: 0.33, maxRecall: 1, passCount: 4, failCount: 1, errorCount: 0 },
		],
		0.67,
	);
	assert.equal(fail.ok, false);
	assert.ok(fail.reasons.some((reason) => reason.includes("low")));
}

function testBuildSweepSummaryShape() {
	const startedAt = "2026-03-07T20:01:00.000Z";
	const finishedAt = "2026-03-07T20:08:00.000Z";
	const runResults = [
		{ effort: "low", runNumber: 1, recall: 1, gateOk: true, retrieval: { mode: "retrieval-aware", used: true, toolCallCount: 2, toolNames: ["lcm_grep"], steps: 2, toolErrorCount: 0 } },
		{ effort: "medium", runNumber: 1, recall: 0, gateOk: false, executionError: "boom", retrieval: { mode: "summary-only", used: false, toolCallCount: 0, toolNames: [], steps: 1, toolErrorCount: 0 } },
	];
	const grouped = groupRunsByEffort(runResults, ["low", "medium"]);
	const effortStats = computeEffortStats(grouped, 0.67);
	const gate = evaluateSweepMeanGate(effortStats, 0.67);

	const summary = buildSweepSummary({
		provider: "openai-codex",
		modelId: "gpt-5.3-codex",
		minRecall: 0.67,
		retrievalMode: "retrieval-aware",
		runsPerEffort: 5,
		efforts: ["low", "medium"],
		startedAt,
		finishedAt,
		runResults,
		effortStats,
		gate,
	});

	assert.equal(summary.provider, "openai-codex");
	assert.equal(summary.modelId, "gpt-5.3-codex");
	assert.equal(summary.config.minRecall, 0.67);
	assert.equal(summary.config.retrievalMode, "retrieval-aware");
	assert.equal(summary.config.runsPerEffort, 5);
	assert.deepEqual(summary.config.efforts, ["low", "medium"]);
	assert.equal(summary.timing.startedAt, startedAt);
	assert.equal(summary.timing.finishedAt, finishedAt);
	assert.equal(summary.timing.totalRuns, 2);
	assert.equal(summary.runs.length, 2);
	assert.equal(summary.byEffort.length, 2);
	assert.equal(summary.gate.ok, false);
}

function run() {
	testGroupRunsByEffort();
	testComputeEffortStats();
	testEvaluateSweepMeanGate();
	testBuildSweepSummaryShape();
	console.log("stage4-live-eval-sweep-core tests passed");
}

run();
