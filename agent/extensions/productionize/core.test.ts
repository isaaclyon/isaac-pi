import test from "node:test";
import assert from "node:assert/strict";
import {
	DEFAULT_STEPS,
	buildPrBody,
	classifyCheck,
	evaluateChecks,
	formatChangedFilesByDirectory,
	formatGitCommandFailure,
	hasDirtyFiles,
	hasPrChanges,
	isLikelyAlreadyMergedPr,
	isLikelyNoChecks,
	isLikelyNonFastForwardPull,
	parseBranchUsedByWorktreeError,
	parseNameStatus,
	parseWorktreeBlockedBranchDelete,
	sanitizeBranchName,
	sanitizeCommitSubject,
	sanitizeMarkdownDescription,
	sanitizePrTitle,
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

test("sanitizeMarkdownDescription bounds multiline AI descriptions", () => {
	assert.equal(sanitizeMarkdownDescription("```markdown\n- changed thing\n```"), "- changed thing");
	assert.equal(sanitizeMarkdownDescription("## Summary\n\n- changed thing"), "- changed thing");
	assert.equal(sanitizeMarkdownDescription("Summary: changed thing"), "changed thing");
	assert.equal(sanitizeMarkdownDescription("\n", "fallback"), "fallback");
	assert.equal(sanitizeMarkdownDescription("word ".repeat(20), "", 24), "word word word word\n\n…");
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

test("buildPrBody includes generated descriptions when provided", () => {
	const body = buildPrBody([], {
		branch: "feat/productionize",
		base: "main",
		description: "- Adds generated PR summaries from git diff context.",
		generatedAt: new Date("2026-05-24T00:00:00.000Z"),
	});
	assert.match(body, /## Summary\n\n- Adds generated PR summaries from git diff context\./);
	assert.doesNotMatch(body, /Prepared by Pi/);
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

test("merge cleanup parsers detect already-merged worktree branch deletion failures", () => {
	const stderr = [
		"! Pull request isaaclyon/photosort#3 was already merged",
		"failed to delete local branch favorites-guardrail: failed to run git: error: cannot delete branch 'favorites-guardrail' used by worktree at '/repo/.worktrees/favorites-guardrail'",
	].join("\n");
	assert.equal(isLikelyAlreadyMergedPr("", stderr), true);
	assert.deepEqual(parseWorktreeBlockedBranchDelete("", stderr), {
		branch: "favorites-guardrail",
		path: "/repo/.worktrees/favorites-guardrail",
	});
	assert.equal(isLikelyAlreadyMergedPr("", "failed to merge pull request"), false);
	assert.equal(parseWorktreeBlockedBranchDelete("", "authentication required"), undefined);
});

test("isLikelyNonFastForwardPull detects only git pull divergence", () => {
	assert.equal(isLikelyNonFastForwardPull("", "fatal: Not possible to fast-forward, aborting."), true);
	assert.equal(isLikelyNonFastForwardPull("", "error: Your local changes would be overwritten by merge"), false);
	assert.equal(isLikelyNonFastForwardPull("", "rejected because remote contains non-fast-forward updates"), false);
});

test("formatGitCommandFailure gives safe remediation for locks and rejected pushes", () => {
	assert.match(
		formatGitCommandFailure(
			["add", "-A"],
			"",
			"fatal: Unable to create '/repo/.git/index.lock': File exists. Another git process seems to be running",
		) ?? "",
		/Productionize did not remove.*index\.lock.*Confirm no Git process is running/si,
	);
	assert.match(
		formatGitCommandFailure(["push"], "", "! [rejected] feat/x -> feat/x (non-fast-forward)") ?? "",
		/never force-push.*fetch.*rebase/si,
	);
});

test("formatGitCommandFailure explains worktree branch conflicts", () => {
	assert.match(
		formatGitCommandFailure(
			["switch", "main"],
			"",
			"fatal: 'main' is already used by worktree at '/repo-main'",
		) ?? "",
		/main.*\/repo-main.*worktree/si,
	);
});

test("evaluateChecks requires at least one non-skipped passing check", () => {
	assert.equal(evaluateChecks([]).status, "pending");
	assert.equal(evaluateChecks([{ name: "docs", bucket: "skipping" }]).status, "pending");
	assert.equal(evaluateChecks([{ name: "lint", bucket: "pass" }]).status, "passed");
	assert.equal(evaluateChecks([{ name: "lint", bucket: "pass" }, { name: "test", bucket: "pending" }]).status, "pending");
	assert.equal(evaluateChecks([{ name: "lint", bucket: "pass" }, { name: "test", bucket: "fail" }]).status, "failed");
});
