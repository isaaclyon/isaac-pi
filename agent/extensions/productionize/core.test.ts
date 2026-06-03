import test from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_STEPS,
	buildFailurePrompt,
	buildPrBody,
	classifyCheck,
	evaluateChecks,
	formatChangedFilesByDirectory,
	hasDirtyFiles,
	hasPrChanges,
	isLikelyNoChecks,
	isLikelyNonFastForwardPull,
	parseBranchUsedByWorktreeError,
	parseNameStatus,
	sanitizeBranchName,
	sanitizeCommitSubject,
	sanitizePrTitle,
	truncateForPrompt,
	type GitHubCheck,
} from "./core.ts";

test("sanitizeBranchName returns conventional safe branch names", () => {
	assert.equal(sanitizeBranchName("Feature/Add Login Flow!!"), "feat/add-login-flow");
	assert.equal(sanitizeBranchName("fix/payment bug; rm -rf /"), "fix/payment-bug-rm-rf");
	assert.equal(sanitizeBranchName("main"), "chore/productionize");
	assert.equal(sanitizeBranchName("```\nbranch name: Docs/Über Cool Thing\n```"), "docs/uber-cool-thing");
});

test("sanitizeBranchName falls back for empty or protected outputs", () => {
	assert.equal(sanitizeBranchName("\n\n"), "chore/productionize");
	assert.equal(sanitizeBranchName("master"), "chore/productionize");
});

test("AI one-line sanitizers collapse malformed output", () => {
	assert.equal(sanitizeCommitSubject("fix: repair tests\n\nBody text"), "fix: repair tests");
	assert.equal(sanitizeCommitSubject("repair tests"), "chore: repair tests");
	assert.equal(sanitizeCommitSubject("\n"), "chore: productionize changes");
	assert.equal(sanitizePrTitle("PR title: Add productionize flow\nmore"), "Add productionize flow");
});

test("default workflow includes return step after merge", () => {
	assert.deepEqual(DEFAULT_STEPS.map((step) => step.id), ["branch", "commit", "push", "pr", "ci", "merge", "return"]);
});

test("hasDirtyFiles detects porcelain status", () => {
	assert.equal(hasDirtyFiles(""), false);
	assert.equal(hasDirtyFiles("\n"), false);
	assert.equal(hasDirtyFiles(" M README.md\n?? new.ts\n"), true);
});

test("parseNameStatus handles normal and renamed files", () => {
	const files = parseNameStatus("M\tagent/extensions/a.ts\nR100\told/name.ts\tnew/name.ts\nA\tREADME.md\n");
	assert.deepEqual(files, [
		{ status: "A", path: "README.md" },
		{ status: "M", path: "agent/extensions/a.ts" },
		{ status: "R100", previousPath: "old/name.ts", path: "new/name.ts" },
	]);
});

test("formatChangedFilesByDirectory groups and sorts deterministically", () => {
	const output = formatChangedFilesByDirectory(
		parseNameStatus("M\tpackages/z.ts\nA\tREADME.md\nD\tagent/old.ts\nM\tpackages/a.ts\n"),
	);
	assert.equal(
		output,
		[
			"### .",
			"- added: `README.md`",
			"",
			"### agent",
			"- deleted: `agent/old.ts`",
			"",
			"### packages",
			"- modified: `packages/a.ts`",
			"- modified: `packages/z.ts`",
		].join("\n"),
	);
});

test("hasPrChanges requires file changes or ahead commits", () => {
	assert.equal(hasPrChanges([], 0), false);
	assert.equal(hasPrChanges(parseNameStatus("M\tREADME.md\n"), 0), true);
	assert.equal(hasPrChanges([], 1), true);
});

test("buildPrBody is deterministic apart from injected timestamp", () => {
	const body = buildPrBody(parseNameStatus("M\tagent/extensions/productionize/core.ts\n"), {
		branch: "feat/productionize",
		base: "main",
		generatedAt: new Date("2026-05-24T00:00:00.000Z"),
	});
	assert.match(body, /Prepared by Pi `\/productionize`/);
	assert.match(body, /- Head: `feat\/productionize`/);
	assert.match(body, /### agent/);
	assert.match(body, /Generated at: 2026-05-24T00:00:00.000Z/);
});

test("classifyCheck maps GitHub buckets to display status", () => {
	assert.equal(classifyCheck({ name: "lint", bucket: "pass", state: "SUCCESS" }), "passed");
	assert.equal(classifyCheck({ name: "test", bucket: "fail", state: "completed" }), "failed");
	assert.equal(classifyCheck({ name: "deploy", bucket: "cancel", state: "completed" }), "failed");
	assert.equal(classifyCheck({ name: "docs", bucket: "skipping", state: "completed" }), "skipped");
	assert.equal(classifyCheck({ name: "build", bucket: "pending", state: "QUEUED" }), "pending");
	assert.equal(classifyCheck({ name: "unknown", state: "completed" }), "pending");
});

test("isLikelyNoChecks detects GitHub no-checks responses", () => {
	assert.equal(isLikelyNoChecks("", "no checks reported on the 'branch' branch"), true);
	assert.equal(isLikelyNoChecks("no checks reported on the 'branch' branch", ""), true);
	assert.equal(isLikelyNoChecks("[]", ""), false);
	assert.equal(isLikelyNoChecks('[{"description":"no status checks configured"}]', ""), false);
	assert.equal(isLikelyNoChecks('[{"name":"lint"}]', "no checks reported"), false);
	assert.equal(isLikelyNoChecks("", "authentication required"), false);
});

test("parseBranchUsedByWorktreeError extracts retry target", () => {
	assert.deepEqual(
		parseBranchUsedByWorktreeError(
			"",
			"fatal: 'main' is already used by worktree at\n '/Users/isaaclyon/Developer/lola-data-platform'",
		),
		{ branch: "main", path: "/Users/isaaclyon/Developer/lola-data-platform" },
	);
	assert.equal(parseBranchUsedByWorktreeError("", "authentication required"), undefined);
});

test("isLikelyNonFastForwardPull detects only git pull divergence", () => {
	assert.equal(isLikelyNonFastForwardPull("", "fatal: Not possible to fast-forward, aborting."), true);
	assert.equal(isLikelyNonFastForwardPull("", "error: Your local changes would be overwritten by merge"), false);
	assert.equal(isLikelyNonFastForwardPull("", "rejected because remote contains non-fast-forward updates"), false);
});

test("evaluateChecks requires at least one non-skipped passing check", () => {
	assert.equal(evaluateChecks([]).status, "pending");
	assert.equal(evaluateChecks([{ name: "docs", bucket: "skipping" }]).status, "pending");
	assert.equal(evaluateChecks([{ name: "lint", bucket: "pass" }]).status, "passed");
	assert.equal(evaluateChecks([{ name: "lint", bucket: "pass" }, { name: "test", bucket: "pending" }]).status, "pending");
	assert.equal(evaluateChecks([{ name: "lint", bucket: "pass" }, { name: "test", bucket: "fail" }]).status, "failed");
});

test("buildFailurePrompt includes failure context and truncates logs", () => {
	const checks: GitHubCheck[] = [{ name: "test", workflow: "CI", bucket: "fail", state: "FAILURE", link: "https://example.test" }];
	const prompt = buildFailurePrompt(
		{
			step: "CI Checks",
			command: "gh",
			args: ["pr", "checks", "123"],
			cwd: "/repo",
			code: 1,
			stdout: "x".repeat(3_000),
			stderr: "failure details",
		},
		{ branch: "feat/thing", prUrl: "https://github.com/acme/repo/pull/123", checks: checks.map((check) => ({ ...check, status: "failed" })) },
	);

	assert.match(prompt, /Step: CI Checks/);
	assert.match(prompt, /Command: gh pr checks 123/);
	assert.match(prompt, /Exit code: 1/);
	assert.match(prompt, /CI \/ test/);
	assert.match(prompt, /characters omitted/);
	assert.ok(prompt.length < 5_000);
});

test("truncateForPrompt preserves short text and marks omitted long text", () => {
	assert.equal(truncateForPrompt("short", 10), "short");
	const long = truncateForPrompt("a".repeat(100), 40);
	assert.match(long, /characters omitted/);
	assert.ok(long.length < 120);
});
