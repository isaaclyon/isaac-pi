import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./workflow.ts", import.meta.url), "utf8");

test("manual productionize retries one autofixable failure before falling back", () => {
	assert.match(source, /state\.auto\.enabled \|\| isAutofixableFailure\(state, failure\.failure\)/);
	assert.match(source, /attemptAutoRepair\(runtime, failure, state\.auto\.enabled \? AUTO_RETRY_LIMIT : 1\)/);
});

test("manual one-shot autofix retry does not require gh default-branch lookup first", () => {
	assert.match(source, /state\.baseBranch \?\? \(!state\.auto\.enabled \? state\.branch : undefined\) \?\? \(await detectDefaultBranch\(runtime, cwd\)\)/);
});

test("manual one-shot autofix retry falls back to manual preview if repair infrastructure throws", () => {
	assert.match(source, /catch \(repairError\) \{/);
	assert.match(source, /if \(state\.auto\.enabled\) throw repairError/);
	assert.match(source, /Automatic autofix retry failed; falling back to manual fix preview/);
	assert.match(source, /throw failure;/);
});
