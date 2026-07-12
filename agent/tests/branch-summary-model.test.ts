import assert from "node:assert/strict";
import test from "node:test";
import { parseBranchSummaryModelSettings } from "../branch-summary-model-config.ts";

test("defaults branch summary thinking to low", () => {
	assert.deepEqual(parseBranchSummaryModelSettings({
		provider: "openai-codex",
		model: "gpt-5.6-terra",
	}), {
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		thinkingLevel: "low",
	});
});

test("preserves an explicit supported thinking level", () => {
	assert.equal(parseBranchSummaryModelSettings({
		provider: "openai-codex",
		model: "gpt-5.6-terra",
		thinkingLevel: "minimal",
	})?.thinkingLevel, "minimal");
});

test("rejects malformed settings", () => {
	assert.equal(parseBranchSummaryModelSettings({ provider: "openai-codex" }), undefined);
	assert.equal(parseBranchSummaryModelSettings({ provider: "openai-codex", model: "terra", thinkingLevel: "turbo" }), undefined);
});
