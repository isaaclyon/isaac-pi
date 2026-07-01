import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSnapshot } from "./auto.ts";
import { buildProductionizeCompletionMessage, buildProductionizeFailurePrompt } from "./handoff.ts";

test("failure prompt includes failure context, rerun instruction, and safety guardrails", () => {
	const state = createDefaultSnapshot(true);
	state.status = "Productionize failed during CI Checks.";
	state.failure = {
		step: "CI Checks",
		command: "pnpm",
		args: ["test", "--filter", "productionize"],
		cwd: "/repo",
		code: 1,
		message: "Tests failed",
		stdout: "ok\n".repeat(500),
		stderr: "boom\n",
	};

	const prompt = buildProductionizeFailurePrompt(state);

	assert.match(prompt, /Fix the issue in this same session/i);
	assert.match(prompt, /call `productionize_run` once after the fix is in place/i);
	assert.match(prompt, /Do not use side agents, patch import\/export, hidden autofix, or autonomous retry loops/i);
	assert.match(prompt, /Failed step: CI Checks/);
	assert.match(prompt, /Run status: Productionize failed during CI Checks\./);
	assert.match(prompt, /Command: pnpm test --filter productionize/);
	assert.match(prompt, /Working directory: \/repo/);
	assert.match(prompt, /Exit code: 1/);
	assert.match(prompt, /Message: Tests failed/);
	assert.match(prompt, /stdout:/);
	assert.match(prompt, /stderr:/);
	assert.match(prompt, /truncated \d+ chars/);
});

test("failure prompt preserves return cleanup status context", () => {
	const state = createDefaultSnapshot(true);
	state.outcome = "failed";
	state.status = "Productionize merged remotely, but local branch cleanup failed. PR is already merged.";
	state.failure = {
		step: "Return",
		command: "git",
		args: ["checkout", "main"],
		message: "local cleanup failed",
	};

	const prompt = buildProductionizeFailurePrompt(state);

	assert.match(prompt, /Run status: Productionize merged remotely, but local branch cleanup failed\. PR is already merged\./);
	assert.match(prompt, /Failed step: Return/);
});

test("completion message returns final status for non-failures", () => {
	assert.equal(
		buildProductionizeCompletionMessage({ outcome: "succeeded", status: "Productionize completed: PR merged.", failure: undefined }),
		"Productionize completed: PR merged.",
	);
	assert.equal(
		buildProductionizeCompletionMessage({ outcome: "cancelled", status: "Productionize cancelled.", failure: undefined }),
		"Productionize cancelled.",
	);
});

test("failed completion message reuses the failure handoff prompt", () => {
	const state = createDefaultSnapshot(true);
	state.outcome = "failed";
	state.status = "Productionize failed during Commit.";
	state.failure = {
		step: "Commit",
		command: "git",
		args: ["commit", "-m", "chore: productionize changes"],
		message: "nothing to commit",
	};

	const message = buildProductionizeCompletionMessage(state);

	assert.match(message, /Productionize failed\./);
	assert.match(message, /Failed step: Commit/);
	assert.match(message, /call `productionize_run` once after the fix is in place/i);
});
