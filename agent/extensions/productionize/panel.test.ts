import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSnapshot } from "./auto.ts";
import { ProductionizePanel } from "./panel.ts";

const theme = {
	fg(_color: string, text: string) {
		return text;
	},
	bold(text: string) {
		return text;
	},
} as const;

test("failed stopped panel hands off on F/f", () => {
	for (const key of ["f", "F"]) {
		const state = createDefaultSnapshot(false);
		state.outcome = "failed";
		state.status = "Productionize failed during CI Checks.";
		state.failure = { step: "CI Checks", message: "Tests failed" };
		const results: Array<{ action: "close" | "handoff" }> = [];

		const panel = new ProductionizePanel(state, theme as any, (result) => results.push(result), () => {
			throw new Error("abort should not be called");
		});
		panel.handleInput(key);

		assert.deepEqual(results, [{ action: "handoff" }]);
	}
});

test("stopped panel keeps Enter and Esc as close-only", () => {
	const state = createDefaultSnapshot(false);
	state.outcome = "failed";
	state.failure = { step: "Commit", message: "nothing to commit" };
	const results: Array<{ action: "close" | "handoff" }> = [];
	const panel = new ProductionizePanel(state, theme as any, (result) => results.push(result), () => {
		throw new Error("abort should not be called");
	});

	panel.handleInput("\r");
	panel.handleInput("\u001B");

	assert.deepEqual(results, [{ action: "close" }, { action: "close" }]);
});

test("running Esc cancels and never hands off", () => {
	const state = createDefaultSnapshot(false);
	state.outcome = "running";
	state.status = "Productionize running...";
	const results: Array<{ action: "close" | "handoff" }> = [];
	let abortCount = 0;
	const panel = new ProductionizePanel(state, theme as any, (result) => results.push(result), () => {
		abortCount += 1;
	});

	panel.handleInput("\u001B");
	panel.handleInput("f");

	assert.equal(state.cancelRequested, true);
	assert.equal(state.status, "Cancelling productionize...");
	assert.equal(abortCount, 1);
	assert.deepEqual(results, []);
});

test("failed panel renders the in-band handoff hint", () => {
	const state = createDefaultSnapshot(true);
	state.outcome = "failed";
	state.status = "Productionize failed during CI Checks.";
	state.failure = {
		step: "CI Checks",
		command: "pnpm",
		args: ["test"],
		message: "Tests failed",
	};
	const panel = new ProductionizePanel(state, theme as any, () => undefined, () => undefined);

	const rendered = panel.render(120).join("\n");

	assert.match(rendered, /Press F to ask the model to fix this in-band\./);
	assert.match(rendered, /Press Enter or Escape to close\./);
});
