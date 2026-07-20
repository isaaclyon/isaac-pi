import assert from "node:assert/strict";
import test from "node:test";
import { createDefaultSnapshot } from "./auto.ts";
import { commandFailure, execCommand, execOrFail } from "./git-runtime.ts";
import { createInitialState, runWorkflow } from "./workflow.ts";
import type { ExecResult } from "./types.ts";

test("transient push transport failures are retried before succeeding", async () => {
	const signal = new AbortController().signal;
	const waits: number[] = [];
	let attempts = 0;
	const result = await execCommand(
		{
			pi: createFakePi(),
			state: createDefaultSnapshot(),
			signal,
			hooks: {
				execCommand: async () => {
					attempts++;
					return attempts < 3 ? fail("", "fatal: unable to access 'https://example.test/repo.git': Could not resolve host") : ok("Everything up-to-date\n");
				},
				sleep: async (ms) => { waits.push(ms); },
			},
		},
		"git",
		["push"],
		"/repo",
		signal,
	);

	assert.equal(result.code, 0);
	assert.equal(attempts, 3);
	assert.deepEqual(waits, [150, 400]);
});

test("destructive push forms are never retried", async () => {
	for (const args of [
		["push", "--force-with-lease=origin/main"],
		["push", "--delete", "origin", "feature"],
		["push", "--mirror", "origin"],
		["push", "--all", "origin"],
		["push", "--tags", "origin"],
	]) {
		let attempts = 0;
		const signal = new AbortController().signal;
		const result = await execCommand(
			{
				pi: createFakePi(),
				state: createDefaultSnapshot(),
				signal,
				hooks: {
					execCommand: async () => {
						attempts++;
						return fail("", "fatal: connection reset by peer");
					},
					sleep: async () => undefined,
				},
			},
			"git",
			args,
			"/repo",
			signal,
		);

		assert.equal(result.code, 1);
		assert.equal(attempts, 1, args.join(" "));
	}
});

test("push hook failures are not retried and retain actionable output", async () => {
	let attempts = 0;
	const runtime = {
		pi: createFakePi(),
		state: createDefaultSnapshot(),
		signal: new AbortController().signal,
		hooks: {
			execCommand: async () => {
				attempts++;
				return fail("", "pre-push hook: lint failed in packages/api");
			},
		},
	};

	await assert.rejects(
		() => execOrFail(runtime, "push", "Push", "git", ["push"], "/repo"),
		(error: unknown) => {
			assert.equal(attempts, 1);
			assert.match(error instanceof Error ? error.message : String(error), /lint failed in packages\/api/i);
			return true;
		},
	);
});

test("terminated Git commands surface timeout context", () => {
	const failure = commandFailure("push", "Push", "git", ["push"], "/repo", { code: 143, stdout: "", stderr: "", killed: true });

	assert.equal(failure.failure.killed, true);
	assert.match(failure.message, /terminated before it completed|timed out/i);
});

test("upstream inspection errors stop before falling back to a different push", async () => {
	const state = createDefaultSnapshot();
	state.branch = "feat/test";
	for (const step of state.steps) step.status = step.id === "push" ? "pending" : "done";
	const seen: string[] = [];

	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
			sleep: async () => undefined,
			execCommand: async (command, args) => {
				const joined = `${command} ${args.join(" ")}`;
				seen.push(joined);
				if (args.join(" ") === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git\n/repo/.git\n");
				if (joined === "git branch --show-current") return ok("feat/test\n");
				if (joined === "git rev-parse --abbrev-ref --symbolic-full-name @{u}") return fail("", "fatal: unable to create '/repo/.git/index.lock': File exists");
			throw new Error(`Unexpected command: ${joined}`);
		},
	});

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /Git is blocked by a lock/i);
	assert.equal(seen.some((command) => command.includes("git push")), false);
});

test("resumed push refuses to publish when the checkout drifted from persisted state", async () => {
	const state = createDefaultSnapshot();
	state.branch = "feat/persisted";
	for (const step of state.steps) step.status = step.id === "push" ? "pending" : "done";
	const seen: string[] = [];

	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
		execCommand: async (command, args) => {
			const joined = `${command} ${args.join(" ")}`;
			seen.push(joined);
			if (args.join(" ") === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git\n/repo/.git\n");
			if (joined === "git branch --show-current") return ok("feat/other\n");
			throw new Error(`Unexpected command: ${joined}`);
		},
	});

	assert.equal(state.outcome, "failed");
	assert.equal(state.failure?.step, "Push");
	assert.match(state.failure?.message ?? "", /current branch is feat\/other instead of feat\/persisted/i);
	assert.equal(seen.some((command) => command.includes("git push")), false);
});

test("branch remote lookup errors do not fall back to origin", async () => {
	const state = createDefaultSnapshot();
	state.branch = "feat/config-error";
	for (const step of state.steps) step.status = step.id === "push" ? "pending" : "done";
	const seen: string[] = [];

	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
		execCommand: async (command, args) => {
			const joined = `${command} ${args.join(" ")}`;
			seen.push(joined);
			if (args.join(" ") === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git\n/repo/.git\n");
			if (joined === "git branch --show-current") return ok("feat/config-error\n");
			if (joined === "git rev-parse --abbrev-ref --symbolic-full-name @{u}") return fail("", "fatal: no upstream configured for branch");
			if (joined === "git config branch.feat/config-error.remote") return fail("", "fatal: bad config file");
			throw new Error(`Unexpected command: ${joined}`);
		},
	});

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.stderr ?? "", /bad config file/i);
	assert.equal(seen.some((command) => command === "git remote" || command.includes("git push")), false);
});

const REPOSITORY_COMMAND = "rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir";
const OPERATION_REFS = new Set([
	"rev-parse -q --verify MERGE_HEAD",
	"rev-parse -q --verify CHERRY_PICK_HEAD",
	"rev-parse -q --verify REBASE_HEAD",
	"rev-parse -q --verify REVERT_HEAD",
]);

test("transient Git lock failures are retried briefly before a branch step continues", async () => {
	const state = createInitialState({ startFrom: "branch", stopAfter: "branch" });
	let repositoryChecks = 0;
	const waits: number[] = [];
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, { startFrom: "branch", stopAfter: "branch" }, {
		sleep: async (ms) => { waits.push(ms); },
		execCommand: async (command, args) => {
			const joined = args.join(" ");
			if (command !== "git") throw new Error(`Unexpected command: ${command}`);
			if (joined === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git\n/repo/.git\n");
			if (joined === "rev-parse --is-inside-work-tree") {
				repositoryChecks++;
				if (repositoryChecks < 3) return fail("", "fatal: Unable to create '/repo/.git/index.lock': File exists.");
				return ok("true\n");
			}
			if (joined === "branch --show-current") return ok("feat/retry-lock\n");
			if (OPERATION_REFS.has(joined)) return fail();
			if (joined === "status --porcelain") return ok();
			throw new Error(`Unexpected command: git ${joined}`);
		},
	});

	assert.equal(state.outcome, "succeeded");
	assert.equal(repositoryChecks, 3);
	assert.deepEqual(waits, [150, 400]);
});

test("successful Git commands are never retried because of warning text", async () => {
	const state = createInitialState({ startFrom: "branch", stopAfter: "branch" });
	let identityCalls = 0;
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, { startFrom: "branch", stopAfter: "branch" }, {
		sleep: async () => undefined,
		execCommand: async (command, args) => {
			const joined = args.join(" ");
			if (command !== "git") throw new Error(`Unexpected command: ${command}`);
			if (joined === REPOSITORY_COMMAND) {
				identityCalls++;
				return ok("/repo\n/repo/.git\n/repo/.git\n", "warning: Unable to create '/repo/.git/index.lock': File exists");
			}
			if (joined === "rev-parse --is-inside-work-tree") return ok("true\n");
			if (joined === "branch --show-current") return ok("feat/warning\n");
			if (OPERATION_REFS.has(joined)) return fail();
			if (joined === "status --porcelain") return ok();
			throw new Error(`Unexpected command: git ${joined}`);
		},
	});

	assert.equal(state.outcome, "succeeded");
	assert.equal(identityCalls, 1);
});

test("a persisted run is rejected in a different repository or worktree", async () => {
	const state = createDefaultSnapshot();
	state.repository = { root: "/other", gitDir: "/other/.git", commonDir: "/other/.git" };
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
		execCommand: async (_command, args) => args.join(" ") === REPOSITORY_COMMAND
			? ok("/repo\n/repo/.git\n/repo/.git\n")
			: fail(),
	});

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /persisted productionize run belongs to \/other/i);
	assert.match(state.failure?.message ?? "", /Start a fresh run in this worktree/i);
});

test("new branch names never reuse an unrelated local collision", async () => {
	const state = createInitialState({ startFrom: "branch", stopAfter: "branch" });
	const baseName = "productionize/2026-07-10T12-00-00-000Z-safe-git";
	const createdName = `${baseName}-2`;
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, { startFrom: "branch", stopAfter: "branch" }, {
		now: () => new Date("2026-07-10T12:00:00.000Z"),
		completeSpark: async () => "fix/safe-git",
		execCommand: async (command, args) => {
			const joined = args.join(" ");
			if (command !== "git") throw new Error(`Unexpected command: ${command}`);
			if (joined === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git\n/repo/.git\n");
			if (joined === "rev-parse --is-inside-work-tree") return ok("true\n");
			if (joined === "branch --show-current") return ok(`${state.branch ?? "main"}\n`);
			if (OPERATION_REFS.has(joined)) return fail();
			if (joined === "status --porcelain") return ok();
			if (joined === "rev-parse --abbrev-ref --symbolic-full-name @{u}") return ok("upstream/main\n");
			if (joined === "rev-list --count upstream/main..HEAD") return ok("0\n");
			if (joined === "for-each-ref --format=%(upstream:remotename)%00%(upstream:remoteref) refs/heads/main") return ok("upstream\0refs/heads/main\n");
			if (joined === `show-ref --verify --quiet refs/heads/${baseName}`) return ok();
			if (joined === `show-ref --verify --quiet refs/heads/${createdName}`) return fail();
			if (joined === `switch -c ${createdName}`) return ok();
			throw new Error(`Unexpected command: git ${joined}`);
		},
	});

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.branch, createdName);
	assert.equal(state.returnRemote, "upstream");
	assert.equal(state.steps.find((step) => step.id === "branch")?.detail, `Created ${createdName}`);
});

test("return updates a base branch in its existing worktree instead of failing", async () => {
	const state = createReturnState();
	const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
		execCommand: async (command, args, cwd) => {
			calls.push({ command, args: [...args], cwd });
			const joined = args.join(" ");
			if (command === "git" && joined === REPOSITORY_COMMAND && cwd === "/repo") return ok("/repo\n/repo/.git/worktrees/feature\n/repo/.git\n");
			if (command === "git" && joined === REPOSITORY_COMMAND && cwd === "/repo-main") return ok("/repo-main\n/repo/.git/worktrees/main\n/repo/.git\n");
			if (command === "git" && joined === "show-ref --verify --quiet refs/heads/main") return ok();
			if (command === "git" && joined === "switch main") return fail("", "fatal: 'main' is already used by worktree at '/repo-main'");
			if (command === "git" && joined === "branch --show-current" && cwd === "/repo-main") return ok("main\n");
			if (command === "git" && joined === "status --porcelain" && cwd === "/repo-main") return ok();
			if (command === "git" && joined === "pull --ff-only origin main" && cwd === "/repo-main") return ok();
			throw new Error(`Unexpected command: ${command} ${joined} in ${cwd}`);
		},
	});

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.returnToBranch, undefined);
	assert.match(state.returnWarning ?? "", /existing worktree at \/repo-main/i);
	assert.ok(calls.some((call) => call.cwd === "/repo-main" && call.args.join(" ") === "pull --ff-only origin main"));
});

test("return leaves a dirty existing worktree unchanged", async () => {
	const state = createReturnState();
	let pullAttempted = false;
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
		execCommand: async (command, args, cwd) => {
			const joined = args.join(" ");
			if (command === "git" && joined === REPOSITORY_COMMAND && cwd === "/repo") return ok("/repo\n/repo/.git/worktrees/feature\n/repo/.git\n");
			if (command === "git" && joined === REPOSITORY_COMMAND && cwd === "/repo-main") return ok("/repo-main\n/repo/.git/worktrees/main\n/repo/.git\n");
			if (command === "git" && joined === "show-ref --verify --quiet refs/heads/main") return ok();
			if (command === "git" && joined === "switch main") return fail("", "fatal: 'main' is already used by worktree at '/repo-main'");
			if (command === "git" && joined === "branch --show-current" && cwd === "/repo-main") return ok("main\n");
			if (command === "git" && joined === "status --porcelain" && cwd === "/repo-main") return ok(" M local.txt\n");
			if (cwd === "/repo-main" && joined === "pull --ff-only origin main") pullAttempted = true;
			throw new Error(`Unexpected command: ${command} ${joined} in ${cwd}`);
		},
	});

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /has local changes.*left it unchanged/i);
	assert.equal(pullAttempted, false);
});

test("return refuses a worktree path from an unrelated repository", async () => {
	const state = createReturnState();
	let foreignPullAttempted = false;
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
		execCommand: async (command, args, cwd) => {
			const joined = args.join(" ");
			if (command === "git" && joined === REPOSITORY_COMMAND && cwd === "/repo") return ok("/repo\n/repo/.git/worktrees/feature\n/repo/.git\n");
			if (command === "git" && joined === "show-ref --verify --quiet refs/heads/main") return ok();
			if (command === "git" && joined === "switch main") return fail("", "fatal: 'main' is already used by worktree at '/foreign'");
			if (command === "git" && joined === REPOSITORY_COMMAND && cwd === "/foreign") return ok("/foreign\n/foreign/.git\n/foreign/.git\n");
			if (cwd === "/foreign" && joined === "pull --ff-only origin main") foreignPullAttempted = true;
			throw new Error(`Unexpected command: ${command} ${joined} in ${cwd}`);
		},
	});

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /does not belong to the productionize repository/i);
	assert.equal(foreignPullAttempted, false);
});

test("failed rebase abort is surfaced instead of leaving cleanup fire-and-forget", async () => {
	const state = createReturnState();
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
		execCommand: async (command, args, cwd) => {
			const joined = args.join(" ");
			if (command === "git" && joined === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git/worktrees/feature\n/repo/.git\n");
			if (command === "git" && joined === "show-ref --verify --quiet refs/heads/main") return ok();
			if (command === "git" && joined === "switch main") return ok();
			if (command === "git" && joined === "pull --ff-only origin main") return fail("", "fatal: Not possible to fast-forward, aborting.");
			if (command === "git" && joined === "status --porcelain") return ok();
			if (command === "git" && joined.startsWith("branch --force productionize-backup/main-")) return ok();
			if (command === "git" && joined === "fetch origin main") return ok();
			if (command === "git" && joined === "rebase FETCH_HEAD") return fail("", "CONFLICT (content): README.md");
			if (command === "git" && joined === "rebase --abort") return fail("", "fatal: could not move back to original HEAD");
			throw new Error(`Unexpected command: ${command} ${joined} in ${cwd}`);
		},
	});

	assert.equal(state.outcome, "failed");
	assert.match(state.failure?.message ?? "", /rebase.*abort.*failed/i);
	assert.match(state.failure?.message ?? "", /repository may still be mid-rebase/i);
});

test("rebase cancellation still awaits an independent abort", async () => {
	const state = createReturnState();
	const controller = new AbortController();
	let abortCompleted = false;
	await runWorkflow(createFakePi(), createFakeContext(), state, controller.signal, () => undefined, {}, {
		execCommand: async (command, args) => {
			const joined = args.join(" ");
			if (command === "git" && joined === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git/worktrees/feature\n/repo/.git\n");
			if (command === "git" && joined === "show-ref --verify --quiet refs/heads/main") return ok();
			if (command === "git" && joined === "switch main") return ok();
			if (command === "git" && joined === "pull --ff-only origin main") return fail("", "fatal: Not possible to fast-forward, aborting.");
			if (command === "git" && joined === "status --porcelain") return ok();
			if (command === "git" && joined.startsWith("branch --force productionize-backup/main-")) return ok();
			if (command === "git" && joined === "fetch origin main") return ok();
			if (command === "git" && joined === "rebase FETCH_HEAD") {
				controller.abort();
				throw new Error("cancelled during rebase");
			}
			if (command === "git" && joined === "rebase --abort") {
				abortCompleted = true;
				return ok();
			}
			throw new Error(`Unexpected command: ${command} ${joined}`);
		},
	});

	assert.equal(state.outcome, "cancelled");
	assert.equal(abortCompleted, true);
});

test("merge cancellation reconciles remote success before reporting cancellation", async () => {
	const state = createMergeState();
	const controller = new AbortController();
	await runWorkflow(createFakePi(), createFakeContext(), state, controller.signal, () => undefined, {}, {
		execCommand: async (command, args) => {
			const joined = args.join(" ");
			if (command === "git" && joined === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git\n/repo/.git\n");
			if (command === "gh" && joined.startsWith("pr merge 3 --squash")) {
				controller.abort();
				throw new Error("cancelled while waiting for gh");
			}
			if (command === "gh" && joined === "pr view 3 --json state,mergedAt") {
				return ok('{"state":"MERGED","mergedAt":"2026-07-10T12:00:00Z"}\n');
			}
			throw new Error(`Unexpected command: ${command} ${joined}`);
		},
	});

	assert.equal(state.outcome, "cancelled");
	assert.equal(state.steps.find((step) => step.id === "merge")?.status, "done");
	assert.match(state.status, /PR merged remotely before cancellation/i);
});

test("merge reconciles a successful PR merge followed by local branch cleanup failure", async () => {
	const state = createMergeState();
	const seen: string[] = [];
	await runWorkflow(createFakePi(), createFakeContext(), state, new AbortController().signal, () => undefined, {}, {
		execCommand: async (command, args) => {
			const joined = args.join(" ");
			seen.push(`${command} ${joined}`);
			if (command === "git" && joined === REPOSITORY_COMMAND) return ok("/repo\n/repo/.git\n/repo/.git\n");
			if (command === "gh" && joined.startsWith("pr merge 3 --squash --delete-branch")) {
				return fail("", "error: cannot delete branch 'feat/test' used by worktree at '/repo'");
			}
			if (command === "gh" && joined === "pr view 3 --json state,mergedAt") {
				return ok('{"state":"MERGED","mergedAt":"2026-07-10T12:00:00Z"}\n');
			}
			throw new Error(`Unexpected command: ${command} ${joined}`);
		},
	});

	assert.equal(state.outcome, "succeeded");
	assert.equal(state.steps.find((step) => step.id === "merge")?.status, "done");
	assert.match(state.steps.find((step) => step.id === "merge")?.detail ?? "", /Merged.*feat\/test remains/i);
	assert.ok(seen.includes("gh pr view 3 --json state,mergedAt"));
});

function createReturnState() {
	const state = createDefaultSnapshot();
	state.remote = "origin";
	state.branch = "feat/test";
	state.returnToBranch = "main";
	state.returnRemote = "origin";
	state.repository = { root: "/repo", gitDir: "/repo/.git/worktrees/feature", commonDir: "/repo/.git" };
	for (const step of state.steps) step.status = step.id === "return" ? "pending" : "done";
	return state;
}

function createMergeState() {
	const state = createDefaultSnapshot();
	state.remote = "origin";
	state.branch = "feat/test";
	state.baseBranch = "main";
	state.pr = { number: 3, title: "Safe git", url: "https://example.test/pr/3", headRefName: "feat/test", headRefOid: "abc" };
	for (const step of state.steps) step.status = step.id === "merge" || step.id === "return" ? "pending" : "done";
	return state;
}

function createFakePi(): any {
	return { appendEntry() {}, sendMessage() {} };
}

function createFakeContext(): any {
	return {
		cwd: "/repo",
		sessionManager: { getBranch: () => [] },
		modelRegistry: { find: () => undefined, getApiKeyAndHeaders: async () => ({ ok: false }) },
	};
}

function ok(stdout = "", stderr = ""): ExecResult {
	return { code: 0, stdout, stderr };
}

function fail(stdout = "", stderr = ""): ExecResult {
	return { code: 1, stdout, stderr };
}
