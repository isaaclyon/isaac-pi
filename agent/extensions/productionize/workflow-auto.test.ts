import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSnapshot } from "./auto.ts";
import { createInitialState, runWorkflow } from "./workflow.ts";
import type { ExecResult } from "./types.ts";

test("scoped commit run executes branch through commit", async () => {
	const state = createInitialState({ startFrom: "branch", stopAfter: "commit" });
	const seen: Array<{ command: string; args: string[] }> = [];
	const sparkPrompts: Array<{ systemPrompt: string; userText: string }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{ startFrom: "branch", stopAfter: "commit" },
		{
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command !== "git") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "rev-parse --is-inside-work-tree") return ok("true\n");
				if (joined === "branch --show-current") return ok("feat/scoped\n");
				if (["rev-parse -q --verify MERGE_HEAD", "rev-parse -q --verify CHERRY_PICK_HEAD", "rev-parse -q --verify REBASE_HEAD", "rev-parse -q --verify REVERT_HEAD"].includes(joined)) return fail();
				if (joined === "status --porcelain") return ok(" M agent/settings.json\n");
				if (joined === "ls-files --stage -- agent/settings.json") return ok("100644 abc 0\tagent/settings.json\n");
				if (joined === "add -A") return ok();
				if (joined === "status --short") return ok("M  agent/settings.json\n");
				if (joined === "diff --cached --name-status") return ok("M\tagent/settings.json\n");
				if (joined === "diff --cached --stat") return ok(" agent/settings.json | 1 +\n 1 file changed, 1 insertion(+)\n");
				if (joined === "diff --cached --no-ext-diff --unified=40") return ok("diff --git a/agent/settings.json b/agent/settings.json\n");
				if (joined === "commit -m chore: productionize changes -m - Records diff context.") return ok();
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
			completeSpark: async (_ctx, systemPrompt, userText) => {
				sparkPrompts.push({ systemPrompt, userText });
				return systemPrompt.includes("commit body") ? "- Records diff context." : "chore: productionize changes";
			},
		},
	);

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.steps.find((step) => step.id === "branch")?.status, "done");
	assert.equal(state.steps.find((step) => step.id === "commit")?.status, "done");
	assert.equal(state.steps.find((step) => step.id === "push")?.status, "skipped");
	assert.match(state.status, /Commit step finished/);
	assert.deepEqual(seen.map(({ command, args }) => `${command} ${args.join(" ")}`), [
		"git rev-parse --is-inside-work-tree",
		"git branch --show-current",
		"git rev-parse -q --verify MERGE_HEAD",
		"git rev-parse -q --verify CHERRY_PICK_HEAD",
		"git rev-parse -q --verify REBASE_HEAD",
		"git rev-parse -q --verify REVERT_HEAD",
		"git status --porcelain",
		"git ls-files --stage -- agent/settings.json",
		"git status --porcelain",
		"git add -A",
		"git status --short",
		"git diff --cached --name-status",
		"git diff --cached --stat",
		"git diff --cached --no-ext-diff --unified=40",
		"git commit -m chore: productionize changes -m - Records diff context.",
	]);
	assert.match(sparkPrompts[0]?.userText ?? "", /## Git status\nM  agent\/settings\.json/);
	assert.match(sparkPrompts[0]?.userText ?? "", /## Diff\ndiff --git/);
	assert.match(sparkPrompts[1]?.userText ?? "", /Commit subject: chore: productionize changes/);
});

test("persisted scoped auto run keeps stopAfter cap when resumed", async () => {
	const state = createInitialState({ auto: true, startFrom: "branch", stopAfter: "commit" });
	state.auto.resumeFromCheckpoint = "branch";
	const seen: Array<{ command: string; args: string[] }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{ auto: true },
		{
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command !== "git") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "rev-parse --is-inside-work-tree") return ok("true\n");
				if (joined === "branch --show-current") return ok("feat/scoped\n");
				if (["rev-parse -q --verify MERGE_HEAD", "rev-parse -q --verify CHERRY_PICK_HEAD", "rev-parse -q --verify REBASE_HEAD", "rev-parse -q --verify REVERT_HEAD"].includes(joined)) return fail();
				if (joined === "status --porcelain") return ok(" M agent/settings.json\n");
				if (joined === "ls-files --stage -- agent/settings.json") return ok("100644 abc 0\tagent/settings.json\n");
				if (joined === "add -A") return ok();
				if (joined === "status --short") return ok("M  agent/settings.json\n");
				if (joined === "diff --cached --name-status") return ok("M\tagent/settings.json\n");
				if (joined === "diff --cached --stat") return ok(" agent/settings.json | 1 +\n 1 file changed, 1 insertion(+)\n");
				if (joined === "diff --cached --no-ext-diff --unified=40") return ok("diff --git a/agent/settings.json b/agent/settings.json\n");
				if (joined === "commit -m chore: productionize changes") return ok();
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
			completeSpark: async (_ctx, systemPrompt) => systemPrompt.includes("commit body") ? "" : "chore: productionize changes",
		},
	);

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.auto.stopAfterCheckpoint, "commit");
	assert.equal(state.steps.find((step) => step.id === "commit")?.status, "done");
	assert.equal(state.steps.find((step) => step.id === "push")?.status, "skipped");
	assert.match(state.status, /Commit step finished/);
	assert.ok(!seen.some(({ command, args }) => command === "git" && args.join(" ") === "push"));
});

test("scoped pr run executes branch through pr", async () => {
	const state = createInitialState({ startFrom: "branch", stopAfter: "pr" });
	const seen: Array<{ command: string; args: string[] }> = [];
	const sparkPrompts: Array<{ systemPrompt: string; userText: string }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{ startFrom: "branch", stopAfter: "pr" },
		{
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				const joined = args.join(" ");
				if (command === "git" && joined === "rev-parse --is-inside-work-tree") return ok("true\n");
				if (command === "git" && joined === "branch --show-current") return ok("feat/scoped\n");
				if (command === "git" && ["rev-parse -q --verify MERGE_HEAD", "rev-parse -q --verify CHERRY_PICK_HEAD", "rev-parse -q --verify REBASE_HEAD", "rev-parse -q --verify REVERT_HEAD"].includes(joined)) return fail();
				if (command === "git" && joined === "status --porcelain") return ok("");
				if (command === "git" && joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") return ok("origin/feat/scoped\n");
				if (command === "git" && joined === "push") return ok();
				if (command === "gh" && joined === "repo view --json defaultBranchRef") return ok('{"defaultBranchRef":{"name":"main"}}\n');
				if (command === "git" && joined === "fetch origin main") return ok();
				if (command === "git" && joined === "diff --name-status FETCH_HEAD...HEAD") return ok("M\tagent/settings.json\n");
				if (command === "git" && joined === "diff --stat FETCH_HEAD...HEAD") return ok(" agent/settings.json | 1 +\n 1 file changed, 1 insertion(+)\n");
				if (command === "git" && joined === "diff --no-ext-diff --unified=40 FETCH_HEAD...HEAD") return ok("diff --git a/agent/settings.json b/agent/settings.json\n");
				if (command === "git" && joined === "log --oneline --no-decorate FETCH_HEAD..HEAD") return ok("abc123 chore: scoped change\n");
				if (command === "git" && joined === "rev-list --count FETCH_HEAD..HEAD") return ok("1\n");
				if (command === "gh" && joined === "pr view --json number,title,url,headRefName,headRefOid") {
					return seen.filter((entry) => entry.command === "gh" && entry.args[0] === "pr" && entry.args[1] === "view").length === 1
						? fail("", "no pull requests found for branch")
						: ok('{"number":12,"title":"Scoped PR","url":"https://example.test/pr/12","headRefName":"feat/scoped","headRefOid":"abc"}\n');
				}
				if (command === "gh" && args[0] === "pr" && args[1] === "create") return ok();
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
			completeSpark: async (_ctx, systemPrompt, userText) => {
				sparkPrompts.push({ systemPrompt, userText });
				return "Scoped PR";
			},
		},
	);

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.branch, "feat/scoped");
	assert.equal(state.remote, "origin");
	assert.equal(state.pr?.number, 12);
	assert.equal(state.steps.find((step) => step.id === "branch")?.status, "done");
	assert.equal(state.steps.find((step) => step.id === "commit")?.status, "done");
	assert.equal(state.steps.find((step) => step.id === "push")?.status, "done");
	assert.equal(state.steps.find((step) => step.id === "pr")?.status, "done");
	assert.equal(state.steps.find((step) => step.id === "ci")?.status, "skipped");
	assert.match(state.status, /Pull Request step finished/);
	const commandLines = seen.map(({ command, args }) => `${command} ${args.join(" ")}`);
	assert.deepEqual(commandLines.slice(0, 19), [
		"git rev-parse --is-inside-work-tree",
		"git branch --show-current",
		"git rev-parse -q --verify MERGE_HEAD",
		"git rev-parse -q --verify CHERRY_PICK_HEAD",
		"git rev-parse -q --verify REBASE_HEAD",
		"git rev-parse -q --verify REVERT_HEAD",
		"git status --porcelain",
		"git status --porcelain",
		"git rev-parse --abbrev-ref --symbolic-full-name @{u}",
		"git push",
		"gh repo view --json defaultBranchRef",
		"git fetch origin main",
		"git diff --name-status FETCH_HEAD...HEAD",
		"git rev-list --count FETCH_HEAD..HEAD",
		"git diff --stat FETCH_HEAD...HEAD",
		"git diff --no-ext-diff --unified=40 FETCH_HEAD...HEAD",
		"git log --oneline --no-decorate FETCH_HEAD..HEAD",
		"gh pr view --json number,title,url,headRefName,headRefOid",
		commandLines[18] ?? "",
	]);
	assert.match(commandLines[18] ?? "", /^gh pr create --base main --head feat\/scoped --title Scoped PR --body\b/);
	assert.equal(commandLines[19], "gh pr view --json number,title,url,headRefName,headRefOid");
	assert.match(sparkPrompts[0]?.userText ?? "", /## Commit log\nabc123 chore: scoped change/);
	assert.match(sparkPrompts[0]?.userText ?? "", /## Diff\ndiff --git/);
	assert.match(sparkPrompts[1]?.userText ?? "", /## Diff stat\nagent\/settings\.json \| 1 \+/);
});

test("protected branches with local-only commits fail before productionize branches off", async () => {
	const state = createDefaultSnapshot();
	const seen: Array<{ command: string; args: string[] }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{},
		{
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command !== "git") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "rev-parse --is-inside-work-tree") return ok("true\n");
				if (joined === "branch --show-current") return ok("main\n");
				if (["rev-parse -q --verify MERGE_HEAD", "rev-parse -q --verify CHERRY_PICK_HEAD", "rev-parse -q --verify REBASE_HEAD", "rev-parse -q --verify REVERT_HEAD"].includes(joined)) return fail();
				if (joined === "status --porcelain") return ok(" M agent/settings.json\n");
				if (joined === "ls-files --stage -- agent/settings.json") return ok("100644 abc 0\tagent/settings.json\n");
				if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") return ok("origin/main\n");
				if (joined === "rev-list --count origin/main..HEAD") return ok("1\n");
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
		},
	);

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /Protected branch main has 1 local commit\(s\) not on origin\/main/i);
	assert.equal(state.steps.find((step) => step.id === "branch")?.status, "failed");
	assert.deepEqual(seen, [
		{ command: "git", args: ["rev-parse", "--is-inside-work-tree"] },
		{ command: "git", args: ["branch", "--show-current"] },
		{ command: "git", args: ["rev-parse", "-q", "--verify", "MERGE_HEAD"] },
		{ command: "git", args: ["rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"] },
		{ command: "git", args: ["rev-parse", "-q", "--verify", "REBASE_HEAD"] },
		{ command: "git", args: ["rev-parse", "-q", "--verify", "REVERT_HEAD"] },
		{ command: "git", args: ["status", "--porcelain"] },
		{ command: "git", args: ["ls-files", "--stage", "--", "agent/settings.json"] },
		{ command: "git", args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"] },
		{ command: "git", args: ["rev-list", "--count", "origin/main..HEAD"] },
	]);
});

test("dirty gitlinks block productionize before commit or branch creation", async () => {
	const state = createDefaultSnapshot();
	const seen: Array<{ command: string; args: string[] }> = [];
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{},
		{
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command !== "git") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "rev-parse --is-inside-work-tree") return ok("true\n");
				if (joined === "branch --show-current") return ok("main\n");
				if (["rev-parse -q --verify MERGE_HEAD", "rev-parse -q --verify CHERRY_PICK_HEAD", "rev-parse -q --verify REBASE_HEAD", "rev-parse -q --verify REVERT_HEAD"].includes(joined)) return fail();
				if (joined === "status --porcelain") return ok(" M .worktrees/vendor-ask-questions\n");
				if (joined === "ls-files --stage -- .worktrees/vendor-ask-questions") return ok("160000 abc 0\t.worktrees/vendor-ask-questions\n");
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
		},
	);

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /dirty gitlinks or nested worktrees/i);
	assert.match(state.failure?.message ?? "", /vendor-ask-questions/);
	assert.deepEqual(seen, [
		{ command: "git", args: ["rev-parse", "--is-inside-work-tree"] },
		{ command: "git", args: ["branch", "--show-current"] },
		{ command: "git", args: ["rev-parse", "-q", "--verify", "MERGE_HEAD"] },
		{ command: "git", args: ["rev-parse", "-q", "--verify", "CHERRY_PICK_HEAD"] },
		{ command: "git", args: ["rev-parse", "-q", "--verify", "REBASE_HEAD"] },
		{ command: "git", args: ["rev-parse", "-q", "--verify", "REVERT_HEAD"] },
		{ command: "git", args: ["status", "--porcelain"] },
		{ command: "git", args: ["ls-files", "--stage", "--", ".worktrees/vendor-ask-questions"] },
	]);
});

test("starting on main branches to a timestamped productionize branch before pushing", async () => {
	const state = createDefaultSnapshot();
	const branchName = "productionize/2026-06-05T22-00-00-000Z-safe-return-rebase";
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
			completeSpark: async () => "fix/safe-return-rebase",
			execCommand: async (command, args) => {
				seen.push({ command, args: [...args] });
				if (command !== "git") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "rev-parse --is-inside-work-tree") return ok("true\n");
				if (joined === "branch --show-current") return ok("main\n");
				if (["rev-parse -q --verify MERGE_HEAD", "rev-parse -q --verify CHERRY_PICK_HEAD", "rev-parse -q --verify REBASE_HEAD", "rev-parse -q --verify REVERT_HEAD"].includes(joined)) return fail();
				if (joined === "status --porcelain") return ok();
				if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") return state.branch === branchName ? fail() : ok("origin/main\n");
				if (joined === "rev-list --count origin/main..HEAD") return ok("0\n");
				if (joined === `show-ref --verify --quiet refs/heads/${branchName}`) return fail();
				if (joined === `checkout -b ${branchName}`) return ok();
				if (joined === `config branch.${branchName}.remote`) return fail();
				if (joined === "remote") return ok("origin\n");
				if (joined === `push -u origin ${branchName}`) return ok();
				if (joined === "fetch origin main") return ok();
				if (joined === "diff --name-status FETCH_HEAD...HEAD") return ok();
				if (joined === "diff --stat FETCH_HEAD...HEAD") return ok();
				if (joined === "diff --no-ext-diff --unified=40 FETCH_HEAD...HEAD") return ok();
				if (joined === "log --oneline --no-decorate FETCH_HEAD..HEAD") return ok();
				if (joined === "rev-list --count FETCH_HEAD..HEAD") return ok("0\n");
				if (joined === "switch main") return ok();
				if (joined === "pull --ff-only origin main") return ok();
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
		},
	);

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.returnToBranch, "main");
	assert.equal(state.steps.find((step) => step.id === "branch")?.detail, `Created ${branchName}`);
	assert.match(state.status, /local checkout returned to main/i);
	assert.ok(seen.some((entry) => entry.args.join(" ") === `checkout -b ${branchName}`));
	assert.ok(seen.some((entry) => entry.args.join(" ") === `push -u origin ${branchName}`));
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

test("return step reports remote merge success separately when local cleanup is blocked", async () => {
	const state = createReturnState();
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{},
		{
			execCommand: async (command, args) => {
				if (command !== "git") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "switch main") return ok();
				if (joined === "pull --ff-only origin main") return fail("", "fatal: Not possible to fast-forward, aborting.");
				if (joined === "status --porcelain") return ok(" M agent/settings.json\n");
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
		},
	);

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /working tree is dirty/i);
	assert.match(state.status, /merged remotely, but local branch cleanup failed/i);
	assert.equal(state.steps.find((step) => step.id === "return")?.status, "failed");
});

test("merge step treats already-merged PR with worktree-blocked local branch cleanup as done", async () => {
	const state = createMergeState();
	await runWorkflow(
		createFakePi(),
		createFakeContext(),
		state,
		new AbortController().signal,
		() => undefined,
		{},
		{
			execCommand: async (command, args) => {
				if (command !== "gh") throw new Error(`Unexpected command: ${command}`);
				const joined = args.join(" ");
				if (joined === "pr merge 3 --squash --delete-branch --match-head-commit f9f76b --subject Favorites guardrail --body ") {
					return fail(
						"",
						[
							"! Pull request isaaclyon/photosort#3 was already merged",
							"failed to delete local branch favorites-guardrail: failed to run git: error: cannot delete branch 'favorites-guardrail' used by worktree at '/repo/.worktrees/favorites-guardrail'",
						].join("\n"),
					);
				}
				throw new Error(`Unexpected command: ${command} ${joined}`);
			},
		},
	);

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.steps.find((step) => step.id === "merge")?.status, "done");
	assert.match(state.steps.find((step) => step.id === "merge")?.detail ?? "", /already merged/i);
	assert.match(state.log.join("\n"), /favorites-guardrail/);
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
	state.pr = { number: 16, title: "PR", url: "https://example.test/pr/16", headRefName: "feat/test", headRefOid: "abc" };
	for (const step of state.steps) step.status = step.id === "return" ? "pending" : "done";
	return state;
}

function createMergeState() {
	const state = createDefaultSnapshot();
	state.remote = "origin";
	state.branch = "favorites-guardrail";
	state.baseBranch = "main";
	state.pr = { number: 3, title: "Favorites guardrail", url: "https://example.test/pr/3", headRefName: "favorites-guardrail", headRefOid: "f9f76b" };
	for (const step of state.steps) step.status = step.id === "merge" || step.id === "return" ? "pending" : "done";
	return state;
}
