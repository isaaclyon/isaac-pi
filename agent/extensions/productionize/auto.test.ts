import assert from "node:assert/strict";
import test from "node:test";
import {
	buildRetryKey,
	createDefaultSnapshot,
	decideResumePlan,
	invalidateForResume,
	parseProductionizeArgs,
	reconstructAutoState,
	recordRetryAttempt,
	serializeStateEntry,
	serializeSummaryEntry,
} from "./auto.ts";

test("/productionize auto parses while manual mode remains default", () => {
	assert.deepEqual(parseProductionizeArgs(""), { auto: false });
	assert.deepEqual(parseProductionizeArgs("auto"), { auto: true });
	assert.deepEqual(parseProductionizeArgs("AUTO"), { auto: true });
	assert.match(parseProductionizeArgs("later").usageError ?? "", /Usage/);
});

test("retry keys increment for same step and sha but reset for a new sha", () => {
	let counts: Record<string, number> = {};
	const firstKey = buildRetryKey("ci", "abc123");
	counts = recordRetryAttempt(counts, firstKey);
	counts = recordRetryAttempt(counts, firstKey);
	const secondKey = buildRetryKey("ci", "def456");
	counts = recordRetryAttempt(counts, secondKey);

	assert.equal(counts[firstKey], 2);
	assert.equal(counts[secondKey], 1);
});

test("resume plan for changed CI head resumes from push and clears downstream state", () => {
	const state = createDefaultSnapshot(true);
	state.pr = { number: 12, title: "PR", url: "https://example.test/pr/12", headRefName: "feat/x", headRefOid: "abc" };
	state.checks = [{ name: "lint", status: "failed" } as any];
	for (const step of state.steps) step.status = "done";

	const next = invalidateForResume(state, decideResumePlan("ci", true));
	assert.equal(next.auto.resumeFromCheckpoint, "push");
	assert.equal(next.pr, undefined);
	assert.deepEqual(next.checks, []);
	assert.equal(next.steps.find((step) => step.id === "push")?.status, "pending");
	assert.equal(next.steps.find((step) => step.id === "pr")?.status, "pending");
	assert.equal(next.steps.find((step) => step.id === "merge")?.status, "pending");
});

test("reconstruction restores retry state, side-session reference, and repair summaries", () => {
	const state = createDefaultSnapshot(true);
	state.auto.retryCounts = { "ci:abc": 2 };
	state.auto.latestSideSessionFile = "/tmp/repair.jsonl";
	state.auto.currentRepair = {
		stepId: "ci",
		attempt: 2,
		maxAttempts: 3,
		status: "running",
		sessionFile: "/tmp/repair.jsonl",
	};
	const summary = {
		stepId: "ci" as const,
		attempt: 2,
		headShaBefore: "abc",
		outcome: "failed" as const,
		sessionFile: "/tmp/repair.jsonl",
		persistedAt: "2026-06-04T00:00:00.000Z",
		summary: "Repair failed",
	};

	const restored = reconstructAutoState([
		{ type: "custom", customType: "productionize-auto-state", data: serializeStateEntry(state, "2026-06-04T00:00:00.000Z") },
		{ type: "custom", customType: "productionize-auto-state", data: serializeSummaryEntry(summary, summary.persistedAt) },
	]);

	assert.equal(restored.state?.auto.reconstructed, true);
	assert.equal(restored.state?.auto.retryCounts["ci:abc"], 2);
	assert.equal(restored.state?.auto.latestSideSessionFile, "/tmp/repair.jsonl");
	assert.equal(restored.state?.auto.lastRepairSummary?.summary, "Repair failed");
	assert.equal(restored.summaries.length, 1);
});
