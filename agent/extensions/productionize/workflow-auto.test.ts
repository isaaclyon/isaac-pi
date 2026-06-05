import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDefaultSnapshot, decideResumePlan, invalidateForResume } from "./auto.ts";

test("merge unchanged head resumes at merge without clearing downstream state", () => {
	const plan = decideResumePlan("merge", false);
	assert.equal(plan.resumeFrom, "merge");
	assert.deepEqual(plan.clearSteps, []);
	assert.equal(plan.clearPr, false);
	assert.equal(plan.clearChecks, false);
});

test("return changed head resumes at push and clears PR plus checks", () => {
	const state = createDefaultSnapshot(true);
	state.pr = { number: 42, title: "Repair", url: "https://example.test/pr/42", headRefName: "feat/x", headRefOid: "abc" };
	state.checks = [{ name: "test", status: "failed" } as any];
	for (const step of state.steps) step.status = "done";

	const resumed = invalidateForResume(state, decideResumePlan("return", true));
	assert.equal(resumed.auto.resumeFromCheckpoint, "push");
	assert.equal(resumed.pr, undefined);
	assert.deepEqual(resumed.checks, []);
	assert.equal(resumed.steps.find((step) => step.id === "push")?.status, "pending");
	assert.equal(resumed.steps.find((step) => step.id === "return")?.status, "pending");
});

test("auto repair prompt is wired to raw failure context, not the manual handoff prompt", () => {
	const source = readFileSync(new URL("./workflow.ts", import.meta.url), "utf8");
	const blockMatch = source.match(/export function buildRepairPrompt[\s\S]*?\n}\n\nasync function appendRepairSummary/);
	assert.ok(blockMatch, "buildRepairPrompt block should exist");
	const block = blockMatch[0];
	assert.match(block, /const context = buildFailureContext\(/);
	assert.doesNotMatch(block, /const context = buildFailurePrompt\(/);
	assert.match(block, /Make the smallest code or file changes needed to address the failure\./);
});

test("pr resume always clears downstream state", () => {
	const state = createDefaultSnapshot(true);
	state.pr = { number: 7, title: "PR", url: "https://example.test/pr/7", headRefName: "feat/x", headRefOid: "abc" };
	for (const step of state.steps) step.status = "done";

	const resumed = invalidateForResume(state, decideResumePlan("pr", false));
	assert.equal(resumed.auto.resumeFromCheckpoint, "pr");
	assert.equal(resumed.pr, undefined);
	assert.equal(resumed.steps.find((step) => step.id === "ci")?.status, "pending");
	assert.equal(resumed.steps.find((step) => step.id === "merge")?.status, "pending");
});
