import assert from "node:assert/strict";
import test from "node:test";
import { MODEL_PRESETS } from "../model-presets-config.ts";

test("uses high or medium thinking for the model presets", () => {
	assert.deepEqual(
		Object.fromEntries(MODEL_PRESETS.map((preset) => [preset.name, preset.thinkingLevel])),
		{
			Maintainer: "medium",
			Implementer: "high",
			Expert: "medium",
			Architect: "high",
		},
	);
});
