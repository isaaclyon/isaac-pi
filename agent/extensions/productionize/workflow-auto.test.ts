import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createDefaultSnapshot, decideResumePlan, invalidateForResume } from "./auto.ts";
import { runWorkflow } from "./workflow.ts";
import type { RepairAttemptSummary } from "./repair-runner.ts";
import type { ExecResult } from "./types.ts";

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

test("auto repair stops if the base branch advances during repair", async () => {
	const state = createDefaultSnapshot(true);
	state.branch = "feat/test";
	state.baseBranch = "main";
	state.auto.activeCheckpoint = "ci";
	state.auto.currentRepair = {
		stepId: "ci",
		attempt: 1,
		maxAttempts: 3,
		status: "running",
		lastPrompt: "fix it",
	};

	let repairCalls = 0;
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{ auto: true },
		{
			repairRunnerFactory: () => ({
				abort() {},
				async start() {
					repairCalls += 1;
					return makeSummary({ stepId: "ci", baseBranch: "main", baseShaBefore: "base-before", patch: "" });
				},
			}),
			execCommand: async (command, args) => {
				assert.equal(command, "git");
				assert.deepEqual(args, ["rev-parse", "main"]);
				return ok("base-after\n");
			},
		},
	);

	assert.equal(repairCalls, 1);
	assert.equal(state.outcome, "failed");
	assert.equal(state.auto.currentRepair, undefined);
	assert.match(state.failure?.message ?? "", /base branch main advanced during repair/i);
	assert.match(state.status, /Productionize failed during CI Checks/);
	assert.equal(state.steps.find((step) => step.id === "ci")?.status, "failed");
});

test("auto repair stops if the pull request closes or merges during repair", async () => {
	const state = createDefaultSnapshot(true);
	state.branch = "feat/test";
	state.baseBranch = "main";
	state.pr = { number: 99, title: "PR", url: "https://example.test/pr/99", headRefName: "feat/test", headRefOid: "head-oid" };
	state.auto.activeCheckpoint = "merge";
	state.auto.currentRepair = {
		stepId: "merge",
		attempt: 1,
		maxAttempts: 3,
		status: "running",
		lastPrompt: "fix it",
	};

	let repairCalls = 0;
	const seen: Array<{ command: string; args: string[] }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{ auto: true },
		{
			repairRunnerFactory: () => ({
				abort() {},
				async start() {
					repairCalls += 1;
					return makeSummary({ stepId: "merge", baseBranch: "main", baseShaBefore: "base-before", patch: "" });
				},
			}),
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command === "git" && args[0] === "rev-parse") return ok("base-before\n");
				if (command === "gh" && args.join(" ") === "pr view 99 --json state,mergedAt") return ok('{"state":"CLOSED","mergedAt":null}\n');
				throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
			},
		},
	);

	assert.equal(repairCalls, 1);
	assert.deepEqual(seen, [
		{ command: "git", args: ["rev-parse", "main"] },
		{ command: "gh", args: ["pr", "view", "99", "--json", "state,mergedAt"] },
	]);
	assert.equal(state.outcome, "failed");
	assert.equal(state.auto.currentRepair, undefined);
	assert.match(state.failure?.message ?? "", /pull request is no longer open/i);
	assert.match(state.status, /Productionize failed during Pull Request/);
});

test("reconcile clears a persisted repair without lastPrompt and resumes from the saved checkpoint", async () => {
	const state = createDefaultSnapshot(true);
	state.branch = "feat/test";
	state.baseBranch = "main";
	state.auto.resumeFromCheckpoint = "push";
	state.auto.currentRepair = {
		stepId: "push",
		attempt: 2,
		maxAttempts: 3,
		status: "running",
	};
	for (const step of state.steps) {
		if (step.id === "branch" || step.id === "commit") step.status = "done";
	}

	let repairCalls = 0;
	const seen: Array<{ command: string; args: string[] }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{ auto: true },
		{
			repairRunnerFactory: () => ({
				abort() {},
				async start() {
					repairCalls += 1;
					return makeSummary();
				},
			}),
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command === "git" && args.join(" ") === "rev-parse --abbrev-ref --symbolic-full-name @{u}") return ok("origin/feat/test\n");
				if (command === "git" && args.join(" ") === "push") return ok();
				if (command === "git" && args.join(" ") === "fetch origin main") return ok();
				if (command === "git" && args.join(" ") === "diff --name-status FETCH_HEAD...HEAD") return ok();
				if (command === "git" && args.join(" ") === "rev-list --count FETCH_HEAD..HEAD") return ok("0\n");
				throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
			},
		},
	);

	assert.equal(repairCalls, 0);
	assert.equal(state.outcome, "succeeded");
	assert.equal(state.auto.currentRepair, undefined);
	assert.equal(state.auto.resumeFromCheckpoint, undefined);
	assert.match(state.status, /no productionize changes to merge/i);
	assert.deepEqual(seen, [
		{ command: "git", args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"] },
		{ command: "git", args: ["push"] },
		{ command: "git", args: ["fetch", "origin", "main"] },
		{ command: "git", args: ["diff", "--name-status", "FETCH_HEAD...HEAD"] },
		{ command: "git", args: ["rev-list", "--count", "FETCH_HEAD..HEAD"] },
	]);
});

test("return step rebases a diverged branch after creating a backup branch", async () => {
	const state = createReturnState();
	const seen: Array<{ command: string; args: string[] }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{},
		{
			now: () => new Date("2026-06-05T22:00:00.000Z"),
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command !== "git") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "switch main") return ok();
				if (joined === "pull --ff-only origin main") return fail("", "fatal: Not possible to fast-forward, aborting.");
				if (joined === "status --porcelain") return ok();
				if (joined === "branch --force productionize-backup/main-2026-06-05T22-00-00-000Z HEAD") return ok();
				if (joined === "fetch origin main") return ok();
				if (joined === "rebase FETCH_HEAD") return ok();
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
		},
	);

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.returnWarning, undefined);
	assert.match(state.status, /returned to main/i);
	assert.deepEqual(seen, [
		{ command: "git", args: ["switch", "main"] },
		{ command: "git", args: ["pull", "--ff-only", "origin", "main"] },
		{ command: "git", args: ["status", "--porcelain"] },
		{ command: "git", args: ["branch", "--force", "productionize-backup/main-2026-06-05T22-00-00-000Z", "HEAD"] },
		{ command: "git", args: ["fetch", "origin", "main"] },
		{ command: "git", args: ["rebase", "FETCH_HEAD"] },
	]);
	assert.equal(state.steps.find((step) => step.id === "return")?.detail, "Rebased onto origin/main");
});

test("return step aborts and fails safely when automatic rebase conflicts", async () => {
	const state = createReturnState();
	const seen: Array<{ command: string; args: string[] }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{},
		{
			now: () => new Date("2026-06-05T22:00:00.000Z"),
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command !== "git") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "switch main") return ok();
				if (joined === "pull --ff-only origin main") return fail("", "fatal: Not possible to fast-forward, aborting.");
				if (joined === "status --porcelain") return ok();
				if (joined === "branch --force productionize-backup/main-2026-06-05T22-00-00-000Z HEAD") return ok();
				if (joined === "fetch origin main") return ok();
				if (joined === "rebase FETCH_HEAD") return fail("", "CONFLICT (content): merge conflict in README.md");
				if (joined === "rebase --abort") return ok();
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
		},
	);

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /Backup branch created: productionize-backup\/main-2026-06-05T22-00-00-000Z/);
	assert.equal(state.steps.find((step) => step.id === "return")?.status, "failed");
	assert.deepEqual(seen, [
		{ command: "git", args: ["switch", "main"] },
		{ command: "git", args: ["pull", "--ff-only", "origin", "main"] },
		{ command: "git", args: ["status", "--porcelain"] },
		{ command: "git", args: ["branch", "--force", "productionize-backup/main-2026-06-05T22-00-00-000Z", "HEAD"] },
		{ command: "git", args: ["fetch", "origin", "main"] },
		{ command: "git", args: ["rebase", "FETCH_HEAD"] },
		{ command: "git", args: ["rebase", "--abort"] },
	]);
});

function createFakePi(): any {
	return {
		appendEntry() {},
		sendMessage() {},
	};
}

function createFakeContext(): any {
	return {
		cwd: "/repo",
		sessionManager: { getBranch: () => [] },
		modelRegistry: {
			find: () => undefined,
			getApiKeyAndHeaders: async () => ({ ok: false }),
		},
	};
}

function ok(stdout = "", stderr = ""): ExecResult {
	return { code: 0, stdout, stderr };
}

function fail(stdout = "", stderr = ""): ExecResult {
	return { code: 1, stdout, stderr };
}

function createReturnState() {
	const state = createDefaultSnapshot();
	state.remote = "origin";
	state.branch = "feat/test";
	state.returnToBranch = "main";
	state.pr = { number: 15, title: "PR", url: "https://example.test/pr/15", headRefName: "feat/test", headRefOid: "abc" };
	for (const step of state.steps) {
		step.status = step.id === "return" ? "pending" : "done";
	}
	return state;
}

function makeSummary(overrides: Partial<RepairAttemptSummary> = {}): RepairAttemptSummary {
	return {
		stepId: overrides.stepId ?? "ci",
		headShaBefore: overrides.headShaBefore ?? "head-before",
		baseBranch: overrides.baseBranch ?? "main",
		baseShaBefore: overrides.baseShaBefore ?? "base-before",
		sessionFile: overrides.sessionFile ?? "/tmp/repair.jsonl",
		childToken: overrides.childToken ?? "token",
		spawnTimestamp: overrides.spawnTimestamp ?? "2026-06-05T00:00:00.000Z",
		outcome: overrides.outcome ?? "succeeded",
		summary: overrides.summary ?? "repair succeeded",
		patchFile: overrides.patchFile ?? "/tmp/repair.patch",
		patch: overrides.patch ?? "",
		tempRoot: overrides.tempRoot ?? "/tmp/repair-root",
		tempWorktree: overrides.tempWorktree ?? "/tmp/repair-worktree",
		verifiedCommand: overrides.verifiedCommand ?? {
			command: "pi",
			args: [],
			cwd: "/tmp/repair-worktree",
			tools: ["read", "edit", "write"],
		},
		protocol: overrides.protocol ?? {
			sawSessionHeader: true,
			sawAssistantMessageEnd: true,
			sawToolExecutionEnd: true,
			terminalState: "completed",
		},
	};
}
