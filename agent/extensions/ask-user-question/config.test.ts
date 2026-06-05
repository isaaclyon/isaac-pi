import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import { loadConfig, validateTimeoutFields } from "./config.ts";

const tempDir = mkdtempSync(join(tmpdir(), "ask-user-question-config-"));

after(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function writeTempConfig(name: string, content: string): string {
	const path = join(tempDir, name);
	writeFileSync(path, content);
	return path;
}

test("loadConfig disables timeout when config file is missing", () => {
	assert.deepEqual(loadConfig(join(tempDir, "missing.json")), {});
});

test("loadConfig disables timeout when config JSON is malformed", () => {
	const path = writeTempConfig("malformed.json", "{ not valid json }");
	assert.deepEqual(loadConfig(path), {});
});

test("loadConfig ignores partial timeout config", () => {
	const path = writeTempConfig(
		"partial.json",
			JSON.stringify({ timeout: { initialQuestionSeconds: 7 }, guidance: { promptSnippet: "Use it" } }),
	);
	assert.deepEqual(loadConfig(path), { guidance: { promptSnippet: "Use it" } });
});

test("loadConfig returns validated timeout config when both values are positive integers", () => {
	const path = writeTempConfig(
		"valid.json",
			JSON.stringify({ timeout: { initialQuestionSeconds: 7, questionSeconds: 2 } }),
	);
	assert.deepEqual(loadConfig(path), {
		timeout: { initialQuestionSeconds: 7, questionSeconds: 2 },
	});
});

test("validateTimeoutFields falls back to disabled for non-positive or non-integer values", () => {
	assert.equal(validateTimeoutFields({ initialQuestionSeconds: 0, questionSeconds: 2 }), undefined);
	assert.equal(validateTimeoutFields({ initialQuestionSeconds: 7, questionSeconds: -1 }), undefined);
	assert.equal(validateTimeoutFields({ initialQuestionSeconds: 7.5, questionSeconds: 2 }), undefined);
	assert.equal(validateTimeoutFields({ initialQuestionSeconds: 7, questionSeconds: "2" }), undefined);
});
