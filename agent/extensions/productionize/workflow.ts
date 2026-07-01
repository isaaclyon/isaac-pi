import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	PRODUCTIONIZE_STATE_CUSTOM_TYPE,
	createDefaultSnapshot,
	serializeStateEntry,
	type ProductionizeStateSnapshot,
} from "./auto.ts";
import {
	buildPrBody,
	checkLabel,
	evaluateChecks,
	hasDirtyFiles,
	hasPrChanges,
	isLikelyNoChecks,
	isLikelyNoPr,
	isLikelyNonFastForwardPull,
	parseBranchUsedByWorktreeError,
	parseNameStatus,
	sanitizeBranchName,
	sanitizeCommitSubject,
	sanitizePrTitle,
	type ChangedFile,
	type CommandFailure,
	type GitHubCheck,
	type StepId,
	type StepStatus,
} from "./core.ts";
import { WorkflowFailure, type ExecResult, type PrInfo, type ProductionizeState } from "./types.ts";

const SPARK_PROVIDER = "openai-codex";
const SPARK_MODEL = "gpt-5.3-codex-spark";
const PROTECTED_BRANCHES = new Set(["main", "master"]);
const COMMAND_TIMEOUT_MS = 120_000;
const CHECK_POLL_INTERVAL_MS = 5_000;
const CHECK_TIMEOUT_MS = 30 * 60_000;
const NO_CHECKS_GRACE_MS = 20_000;
const CHECK_FIELDS = "name,workflow,bucket,state,link,description,startedAt,completedAt";
const PR_FIELDS = "number,title,url,headRefName,headRefOid";
const STEP_ORDER: StepId[] = ["branch", "commit", "push", "pr", "ci", "merge", "return"];

type SparkMessage = {
	role: "user";
	content: Array<{ type: "text"; text: string }>;
	timestamp: number;
};

export interface ProductionizeRunOptions {
	auto?: boolean;
	startFrom?: StepId;
	stopAfter?: StepId;
}

export interface WorkflowHooks {
	execCommand?: (
		command: string,
		args: string[],
		cwd: string,
		signal: AbortSignal,
		timeout: number,
	) => Promise<ExecResult>;
	completeSpark?: (ctx: ExtensionContext, systemPrompt: string, userText: string, fallback: string, signal: AbortSignal) => Promise<string>;
	now?: () => Date;
}

interface WorkflowRuntime {
	pi: ExtensionAPI;
	ctx: ExtensionContext;
	state: ProductionizeState;
	signal: AbortSignal;
	render: () => void;
	hooks: WorkflowHooks;
}

interface StepResult {
	next?: StepId;
	finished?: true;
}

export function createInitialState(options: ProductionizeRunOptions = {}): ProductionizeState {
	const state = createDefaultSnapshot(Boolean(options.auto));
	state.auto.startFromCheckpoint = options.startFrom;
	state.auto.stopAfterCheckpoint = options.stopAfter;
	applyStepScope(state, options);
	return state;
}

export async function runWorkflow(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	state: ProductionizeState,
	signal: AbortSignal,
	render: () => void,
	options: ProductionizeRunOptions = {},
	hooks: WorkflowHooks = {},
): Promise<void> {
	state.auto.enabled = options.auto ?? state.auto.enabled;
	state.auto.startFromCheckpoint = options.startFrom ?? state.auto.startFromCheckpoint;
	state.auto.stopAfterCheckpoint = options.stopAfter ?? state.auto.stopAfterCheckpoint;
	const startFrom = options.startFrom ?? state.auto.startFromCheckpoint;
	const stopAfter = options.stopAfter ?? state.auto.stopAfterCheckpoint;
	applyStepScope(state, { startFrom, stopAfter });
	const runtime: WorkflowRuntime = {
		pi,
		ctx,
		state,
		signal,
		render,
		hooks,
	};

	try {
		if (state.auto.enabled) {
			state.auto.startTimestamp ??= timestamp(hooks);
			await persistState(runtime);
		}
		let currentStep = state.auto.resumeFromCheckpoint ?? startFrom ?? firstPendingStep(state) ?? "branch";
		while (true) {
			if (signal.aborted || state.cancelRequested) throw new Error("cancelled");
			state.auto.activeCheckpoint = currentStep;
			state.auto.resumeFromCheckpoint = currentStep;
			await persistState(runtime);
			render();

			try {
				await hydrateStateForStep(runtime, currentStep);
				const result = await runStep(runtime, currentStep);
				if (result.finished) {
					markSuccess(state);
					if (state.auto.enabled) await persistState(runtime);
					render();
					return;
				}
				if (stopAfter === currentStep) {
					markScopedSuccess(state, currentStep);
					if (state.auto.enabled) await persistState(runtime);
					render();
					return;
				}
				currentStep = result.next ?? nextStep(currentStep);
				continue;
			} catch (error) {
				if (signal.aborted || state.cancelRequested) throw error;
				throw error instanceof WorkflowFailure ? error : unknownFailure(currentStep, labelForStep(currentStep), error);
			}
		}
	} catch (error) {
		if (signal.aborted || state.cancelRequested) {
			state.outcome = "cancelled";
			state.status = "Productionize cancelled.";
			markRunningCancelled(state);
			if (state.auto.enabled) await persistState(runtime);
			render();
			return;
		}

		const failure = error instanceof WorkflowFailure ? error : unknownFailure(state.auto.activeCheckpoint ?? "branch", "Workflow", error);
		stateForFailure(runtime, failure);
		if (state.auto.enabled) {
			await persistState(runtime);
			render();
			return;
		}
		render();
	}
}

async function runStep(runtime: WorkflowRuntime, stepId: StepId): Promise<StepResult> {
	switch (stepId) {
		case "branch": {
			await runBranchStep(runtime);
			return { next: "commit" };
		}
		case "commit": {
			await runCommitStep(runtime);
			return { next: "push" };
		}
		case "push": {
			await runPushStep(runtime);
			return { next: "pr" };
		}
		case "pr": {
			const pr = await runPrStep(runtime);
			return { next: pr ? "ci" : "return" };
		}
		case "ci": {
			await runCiStep(runtime);
			return { next: "merge" };
		}
		case "merge": {
			await runMergeStep(runtime);
			return { next: "return" };
		}
		case "return": {
			await runReturnStep(runtime);
			return { finished: true };
		}
	}
}

async function hydrateStateForStep(runtime: WorkflowRuntime, stepId: StepId): Promise<void> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	if (stepId === "branch") return;

	if (!state.branch) {
		const currentResult = await execOrFail(runtime, stepId, "Current branch", "git", ["branch", "--show-current"], cwd);
		const currentBranch = currentResult.stdout.trim();
		if (!currentBranch) {
			throw new WorkflowFailure(stepId, {
				step: labelForStep(stepId),
				command: "git",
				args: ["branch", "--show-current"],
				cwd,
				message: `Detached HEAD is not supported by /productionize ${stepId}.`,
			});
		}
		state.branch = currentBranch;
	}

	if (!state.remote && ["pr", "ci", "merge", "return"].includes(stepId)) {
		state.remote = await inferBranchRemote(runtime, cwd, state.branch, stepId);
	}

	if (!state.pr && ["ci", "merge"].includes(stepId)) {
		state.pr = await fetchPrInfo(runtime, cwd);
	}
}

async function runBranchStep(runtime: WorkflowRuntime): Promise<void> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	setStep(state, "branch", "running", "Checking current branch");
	state.status = "Checking git branch...";
	await update(runtime);

	await execOrFail(runtime, "branch", "Repository check", "git", ["rev-parse", "--is-inside-work-tree"], cwd);
	const currentResult = await execOrFail(runtime, "branch", "Current branch", "git", ["branch", "--show-current"], cwd);
	const currentBranch = currentResult.stdout.trim();
	if (!currentBranch) {
		throw new WorkflowFailure("branch", {
			step: "Branch",
			command: "git",
			args: ["branch", "--show-current"],
			cwd,
			message: "Detached HEAD is not supported by /productionize.",
		});
	}

	await ensureSafeStartState(runtime, currentBranch);
	if (!PROTECTED_BRANCHES.has(currentBranch)) {
		state.branch = currentBranch;
		setStep(state, "branch", "done", `Reusing ${currentBranch}`);
		log(state, `Reusing branch ${currentBranch}`);
		await update(runtime);
		return;
	}

	const branchName = buildProductionizeBranchName(
		await completeSparkWithHooks(
			runtime,
			"Generate one git branch name. Output only the branch name.",
			`Use a conventional prefix such as feat/, fix/, chore/, docs/, test/, or refactor/. Use lowercase kebab-case. Base it on these recent Pi user/assistant messages:\n\n${recentConversationText(ctx, 10)}`,
			"chore/productionize",
		),
		runtime.hooks,
	);

	state.baseBranch = currentBranch;
	state.returnToBranch = currentBranch;
	if (await localBranchExists(runtime, cwd, branchName)) {
		setStep(state, "branch", "running", `Switching to existing ${branchName}`);
		state.status = `Switching to existing branch ${branchName}...`;
		await update(runtime);
		await execOrFail(runtime, "branch", "Switch branch", "git", ["checkout", branchName], cwd);
		state.branch = branchName;
		setStep(state, "branch", "done", `Reused ${branchName}`);
		log(state, `Switched to existing branch ${branchName}`);
		await update(runtime);
		return;
	}

	setStep(state, "branch", "running", `Creating ${branchName}`);
	state.status = `Creating branch ${branchName}...`;
	await update(runtime);
	await execOrFail(runtime, "branch", "Create branch", "git", ["checkout", "-b", branchName], cwd);
	state.branch = branchName;
	setStep(state, "branch", "done", `Created ${branchName}`);
	log(state, `Created branch ${branchName}`);
	await update(runtime);
}

async function runCommitStep(runtime: WorkflowRuntime): Promise<void> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	setStep(state, "commit", "running", "Checking dirty files");
	state.status = "Checking dirty files...";
	await update(runtime);

	const status = await execOrFail(runtime, "commit", "Git status", "git", ["status", "--porcelain"], cwd);
	if (!hasDirtyFiles(status.stdout)) {
		setStep(state, "commit", "done", "No dirty files");
		log(state, "No dirty files to commit");
		await update(runtime);
		return;
	}

	await execOrFail(runtime, "commit", "Stage files", "git", ["add", "-A"], cwd);
	const nameStatus = await execOrFail(runtime, "commit", "Staged file list", "git", ["diff", "--cached", "--name-status"], cwd);
	const stat = await execOrFail(runtime, "commit", "Staged diff stat", "git", ["diff", "--cached", "--stat"], cwd);
	state.changedFiles = parseNameStatus(nameStatus.stdout);

	const subject = sanitizeCommitSubject(
		await completeSparkWithHooks(
			runtime,
			"Generate one Conventional Commit subject. Output only the subject line.",
			`Create a concise commit subject for these staged changes.\n\nStatus:\n${nameStatus.stdout}\n\nStat:\n${stat.stdout}`,
			"chore: productionize changes",
		),
	);

	setStep(state, "commit", "running", subject);
	state.status = "Committing dirty files...";
	await update(runtime);
	await execOrFail(runtime, "commit", "Commit", "git", ["commit", "-m", subject], cwd);
	setStep(state, "commit", "done", subject);
	log(state, `Committed changes: ${subject}`);
	await update(runtime);
}

async function runPushStep(runtime: WorkflowRuntime): Promise<void> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	const branch = requiredState(state.branch, "Push step requires branch state.");
	setStep(state, "push", "running", "Detecting upstream");
	state.status = "Pushing branch...";
	await update(runtime);

	const upstream = await execCommand(runtime, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd, runtime.signal, 30_000);
	if (upstream.code === 0 && upstream.stdout.trim()) {
		const remote = upstream.stdout.trim().split("/")[0] ?? "origin";
		state.remote = remote;
		await execOrFail(runtime, "push", "Push", "git", ["push"], cwd);
		setStep(state, "push", "done", `Pushed to ${upstream.stdout.trim()}`);
		log(state, `Pushed to existing upstream ${upstream.stdout.trim()}`);
		await update(runtime);
		return;
	}

	const remote = await choosePushRemote(runtime, cwd, branch);
	state.remote = remote;
	await execOrFail(runtime, "push", "Push with upstream", "git", ["push", "-u", remote, branch], cwd);
	setStep(state, "push", "done", `Pushed to ${remote}/${branch}`);
	log(state, `Pushed and set upstream ${remote}/${branch}`);
	await update(runtime);
}

async function runPrStep(runtime: WorkflowRuntime): Promise<PrInfo | undefined> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	const branch = requiredState(state.branch, "PR step requires branch state.");
	const remote = requiredState(state.remote, "PR step requires remote state.");

	setStep(state, "pr", "running", "Preparing PR");
	state.status = "Opening pull request...";
	await update(runtime);

	const base = state.baseBranch ?? (await detectDefaultBranch(runtime, cwd));
	state.baseBranch = base;
	const prDelta = await inspectPrDelta(runtime, cwd, remote, base);
	state.changedFiles = prDelta.files;
	if (!prDelta.hasChanges) {
		setStep(state, "pr", "skipped", "No changes to merge");
		setStep(state, "ci", "skipped", "No PR: no changes detected");
		setStep(state, "merge", "skipped", "No PR: no changes detected");
		state.status = "No productionize changes to merge.";
		log(state, `Skipped PR creation because ${branch} has no commits or file changes relative to ${base}`);
		await update(runtime);
		return undefined;
	}
	const body = buildPrBody(state.changedFiles, { branch, base });
	const title = sanitizePrTitle(
		await completeSparkWithHooks(
			runtime,
			"Generate one GitHub pull request title. Output only the title.",
			`Create a concise PR title for this branch and changed-file list.\n\nBranch: ${branch}\nBase: ${base}\n\n${body}`,
			"Productionize changes",
		),
	);

	const existing = await execCommand(runtime, "gh", ["pr", "view", "--json", PR_FIELDS], cwd, runtime.signal, COMMAND_TIMEOUT_MS);
	let pr: PrInfo;
	if (existing.code === 0) {
		pr = parseJson<PrInfo>(existing.stdout, "existing PR", "pr", "Pull Request", "gh", ["pr", "view", "--json", PR_FIELDS], cwd);
		await execOrFail(runtime, "pr", "Update PR", "gh", ["pr", "edit", String(pr.number), "--title", title, "--body", body], cwd);
		pr = await fetchPrInfo(runtime, cwd);
		log(state, `Updated existing PR #${pr.number}`);
	} else if (isLikelyNoPr(existing.stdout, existing.stderr)) {
		await execOrFail(runtime, "pr", "Create PR", "gh", ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body], cwd, 180_000);
		pr = await fetchPrInfo(runtime, cwd);
		log(state, `Created PR #${pr.number}`);
	} else {
		throw new WorkflowFailure("pr", {
			step: "Pull Request",
			command: "gh",
			args: ["pr", "view", "--json", PR_FIELDS],
			cwd,
			code: existing.code,
			stdout: existing.stdout,
			stderr: existing.stderr,
			message: "Failed to inspect existing pull request.",
		});
	}

	state.pr = pr;
	setStep(state, "pr", "done", `#${pr.number} ${pr.url}`);
	await update(runtime);
	return pr;
}

async function runCiStep(runtime: WorkflowRuntime): Promise<void> {
	const { state, ctx, signal } = runtime;
	const cwd = ctx.cwd;
	const pr = requiredState(state.pr, "CI step requires PR state.");
	setStep(state, "ci", "running", "Waiting for checks");
	state.status = "Polling GitHub checks...";
	await update(runtime);

	const started = Date.now();
	while (Date.now() - started < CHECK_TIMEOUT_MS) {
		if (signal.aborted) throw new Error("cancelled");
		const checks = await fetchChecks(runtime, cwd, pr.number);
		const evaluation = evaluateChecks(checks);
		state.checks = [...evaluation.passed, ...evaluation.pending, ...evaluation.failed, ...evaluation.skipped].sort((a, b) => checkLabel(a).localeCompare(checkLabel(b)));
		if (evaluation.status === "passed") {
			setStep(state, "ci", "done", `${evaluation.passed.length} check(s) passed`);
			log(state, `${evaluation.passed.length} GitHub check(s) passed`);
			await update(runtime);
			return;
		}
		if (evaluation.status === "failed") {
			throw new WorkflowFailure("ci", {
				step: "CI Checks",
				command: "gh",
				args: ["pr", "checks", String(pr.number), "--json", CHECK_FIELDS],
				cwd,
				code: 1,
				stdout: checks.map((check) => `${check.bucket ?? "unknown"}\t${checkLabel(check)}`).join("\n"),
				stderr: "One or more GitHub checks failed or were cancelled.",
				message: "GitHub checks failed.",
			});
		}
		const pendingCount = evaluation.pending.length;
		const discovered = checks.length;
		if (discovered === 0 && Date.now() - started >= NO_CHECKS_GRACE_MS) {
			setStep(state, "ci", "skipped", "No checks reported");
			log(state, `No GitHub checks were reported after ${Math.round(NO_CHECKS_GRACE_MS / 1000)} seconds; continuing without CI`);
			await update(runtime);
			return;
		}
		setStep(state, "ci", "running", discovered === 0 ? "No checks discovered yet" : `${pendingCount} pending`);
		log(state, discovered === 0 ? "No GitHub checks discovered yet" : `Waiting for ${pendingCount} pending check(s)`);
		await update(runtime);
		await delay(CHECK_POLL_INTERVAL_MS, signal);
	}

	throw new WorkflowFailure("ci", {
		step: "CI Checks",
		command: "gh",
		args: ["pr", "checks", String(pr.number), "--json", CHECK_FIELDS],
		cwd,
		message: `Timed out after ${Math.round(CHECK_TIMEOUT_MS / 60_000)} minutes waiting for GitHub checks.`,
	});
}

async function runMergeStep(runtime: WorkflowRuntime): Promise<void> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	const pr = requiredState(state.pr, "Merge step requires PR state.");
	setStep(state, "merge", "running", "Squash merging");
	state.status = "Squash merging PR and deleting remote branch...";
	await update(runtime);

	const mergeArgs = ["pr", "merge", String(pr.number), "--squash", "--delete-branch", "--match-head-commit", pr.headRefOid, "--subject", pr.title, "--body", ""];
	const result = await execCommand(runtime, "gh", mergeArgs, cwd, runtime.signal, 180_000);
	if (result.code !== 0) {
		const usedWorktree = parseBranchUsedByWorktreeError(result.stdout, result.stderr);
		if (!usedWorktree || (usedWorktree.branch !== state.baseBranch && !PROTECTED_BRANCHES.has(usedWorktree.branch))) {
			throw commandFailure("merge", "Squash merge", "gh", mergeArgs, cwd, result);
		}

		setStep(state, "merge", "running", `Retrying from ${usedWorktree.branch} worktree`);
		log(state, `Retrying merge from worktree ${usedWorktree.path}`);
		await update(runtime);
		const retry = await execCommand(runtime, "gh", mergeArgs, usedWorktree.path, runtime.signal, 180_000);
		if (retry.code !== 0) {
			throw commandFailure("merge", "Squash merge", "gh", mergeArgs, usedWorktree.path, retry);
		}
	}
	setStep(state, "merge", "done", "Squash merged; delete branch requested");
	log(state, `Merged PR #${pr.number}`);
	await update(runtime);
}

async function runReturnStep(runtime: WorkflowRuntime): Promise<void> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	const remote = requiredState(state.remote, "Return step requires remote state.");
	const branch = state.returnToBranch;
	if (!branch) {
		setStep(state, "return", "skipped", "Started on existing branch");
		await update(runtime);
		return;
	}

	setStep(state, "return", "running", `Switching to ${branch}`);
	state.status = `Switching back to ${branch}...`;
	await update(runtime);
	await execOrFail(runtime, "return", "Return to base branch", "git", ["switch", branch], cwd);
	state.branch = branch;
	state.returnWarning = undefined;

	setStep(state, "return", "running", `Pulling ${remote}/${branch}`);
	state.status = `Pulling latest ${branch} from ${remote}...`;
	await update(runtime);
	const pullArgs = ["pull", "--ff-only", remote, branch];
	const pull = await execCommand(runtime, "git", pullArgs, cwd, runtime.signal, 180_000);
	if (pull.code !== 0) {
		if (!isLikelyNonFastForwardPull(pull.stdout, pull.stderr)) {
			throw commandFailure("return", "Pull base branch", "git", pullArgs, cwd, pull);
		}
		await reconcileReturnBranch(runtime, remote, branch);
		setStep(state, "return", "done", `Rebased onto ${remote}/${branch}`);
		log(state, `Returned to ${branch} and rebased onto ${remote}/${branch}`);
		await update(runtime);
		return;
	}

	setStep(state, "return", "done", `Updated ${branch}`);
	log(state, `Returned to ${branch} and pulled ${remote}/${branch}`);
	await update(runtime);
}

async function reconcileReturnBranch(runtime: WorkflowRuntime, remote: string, branch: string): Promise<void> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	setStep(state, "return", "running", `Reconciling ${branch}`);
	state.status = `Rebasing local ${branch} onto ${remote}/${branch}...`;
	await update(runtime);

	const status = await execOrFail(runtime, "return", "Check return branch status", "git", ["status", "--porcelain"], cwd);
	if (hasDirtyFiles(status.stdout)) {
		throw new WorkflowFailure("return", {
			step: "Pull base branch",
			command: "git",
			args: ["status", "--porcelain"],
			cwd,
			stdout: status.stdout,
			stderr: status.stderr,
			message: `Cannot automatically reconcile diverged ${branch} because the working tree is dirty. Restore or stash local changes and rerun /productionize.`,
		});
	}

	const backupBranch = buildReturnBackupBranch(branch, runtime.hooks);
	await execOrFail(runtime, "return", "Create return backup branch", "git", ["branch", "--force", backupBranch, "HEAD"], cwd);
	await execOrFail(runtime, "return", "Fetch return branch", "git", ["fetch", remote, branch], cwd, 180_000);

	const rebaseArgs = ["rebase", "FETCH_HEAD"];
	const rebase = await execCommand(runtime, "git", rebaseArgs, cwd, runtime.signal, 180_000);
	if (rebase.code === 0) return;
	void execCommand(runtime, "git", ["rebase", "--abort"], cwd, runtime.signal, 30_000).catch(() => undefined);
	throw new WorkflowFailure("return", {
		step: "Pull base branch",
		command: "git",
		args: rebaseArgs,
		cwd,
		code: rebase.code,
		stdout: rebase.stdout,
		stderr: rebase.stderr,
		message: `Automatic rebase of ${branch} onto ${remote}/${branch} failed. Backup branch created: ${backupBranch}. Resolve manually.`,
	});
}

async function completeSparkWithHooks(
	runtime: WorkflowRuntime,
	systemPrompt: string,
	userText: string,
	fallback: string,
): Promise<string> {
	if (runtime.hooks.completeSpark) return runtime.hooks.completeSpark(runtime.ctx, systemPrompt, userText, fallback, runtime.signal);
	return completeSpark(runtime.ctx, systemPrompt, userText, fallback, runtime.signal);
}

async function completeSpark(
	ctx: ExtensionContext,
	systemPrompt: string,
	userText: string,
	fallback: string,
	signal: AbortSignal,
): Promise<string> {
	const model = ctx.modelRegistry.find(SPARK_PROVIDER, SPARK_MODEL);
	if (!model) return fallback;
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) return fallback;

	const message: SparkMessage = {
		role: "user",
		content: [{ type: "text", text: userText }],
		timestamp: Date.now(),
	};
	const { complete } = await import("@earendil-works/pi-ai");
	const response = await complete(model, { systemPrompt, messages: [message] }, { apiKey: auth.apiKey, headers: auth.headers, signal });
	if (response.stopReason === "aborted") return fallback;
	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
	return text || fallback;
}

async function localBranchExists(runtime: WorkflowRuntime, cwd: string, branch: string): Promise<boolean> {
	const result = await execCommand(runtime, "git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd, runtime.signal, 30_000);
	return result.code === 0;
}

async function inferBranchRemote(runtime: WorkflowRuntime, cwd: string, branch: string, stepId: StepId): Promise<string> {
	const upstream = await execCommand(runtime, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd, runtime.signal, 30_000);
	if (upstream.code === 0 && upstream.stdout.trim()) return upstream.stdout.trim().split("/")[0] ?? "origin";

	const configured = await execCommand(runtime, "git", ["config", `branch.${branch}.remote`], cwd, runtime.signal, 30_000);
	if (configured.code === 0 && configured.stdout.trim() && configured.stdout.trim() !== ".") return configured.stdout.trim();

	const remotes = await execCommand(runtime, "git", ["remote"], cwd, runtime.signal, 30_000);
	const names = remotes.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
	if (names.includes("origin")) return "origin";
	if (names[0]) return names[0];
	throw new WorkflowFailure(stepId, {
		step: labelForStep(stepId),
		command: "git",
		args: ["remote"],
		cwd,
		code: remotes.code,
		stdout: remotes.stdout,
		stderr: remotes.stderr,
		message: `No git remote is configured for /productionize ${stepId}.`,
	});
}

async function choosePushRemote(runtime: WorkflowRuntime, cwd: string, branch: string): Promise<string> {
	const configured = await execCommand(runtime, "git", ["config", `branch.${branch}.remote`], cwd, runtime.signal, 30_000);
	if (configured.code === 0 && configured.stdout.trim() && configured.stdout.trim() !== ".") return configured.stdout.trim();

	const remotes = await execOrFail(runtime, "push", "List remotes", "git", ["remote"], cwd, 30_000);
	const names = remotes.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
	if (names.includes("origin")) return "origin";
	if (names[0]) return names[0];
	throw new WorkflowFailure("push", { step: "Push", command: "git", args: ["remote"], cwd, stdout: remotes.stdout, stderr: remotes.stderr, message: "No git remote is configured." });
}

async function detectDefaultBranch(runtime: WorkflowRuntime, cwd: string): Promise<string> {
	const result = await execOrFail(runtime, "pr", "Detect default branch", "gh", ["repo", "view", "--json", "defaultBranchRef"], cwd);
	const data = parseJson<{ defaultBranchRef?: { name?: string } }>(result.stdout, "default branch", "pr", "Pull Request", "gh", ["repo", "view", "--json", "defaultBranchRef"], cwd);
	return data.defaultBranchRef?.name || "main";
}

async function inspectPrDelta(runtime: WorkflowRuntime, cwd: string, remote: string, base: string): Promise<{ files: ChangedFile[]; commitCount: number; hasChanges: boolean }> {
	await execOrFail(runtime, "pr", "Fetch PR base", "git", ["fetch", remote, base], cwd, 180_000);
	const diff = await execOrFail(runtime, "pr", "Changed files", "git", ["diff", "--name-status", "FETCH_HEAD...HEAD"], cwd, COMMAND_TIMEOUT_MS);
	const commits = await execOrFail(runtime, "pr", "Changed commit count", "git", ["rev-list", "--count", "FETCH_HEAD..HEAD"], cwd, COMMAND_TIMEOUT_MS);
	const files = parseNameStatus(diff.stdout);
	const commitCount = Number.parseInt(commits.stdout.trim(), 10);
	const safeCommitCount = Number.isFinite(commitCount) ? commitCount : files.length;
	return { files, commitCount: safeCommitCount, hasChanges: hasPrChanges(files, safeCommitCount) };
}

async function fetchPrInfo(runtime: WorkflowRuntime, cwd: string): Promise<PrInfo> {
	const result = await execOrFail(runtime, "pr", "Fetch PR", "gh", ["pr", "view", "--json", PR_FIELDS], cwd);
	return parseJson<PrInfo>(result.stdout, "PR", "pr", "Pull Request", "gh", ["pr", "view", "--json", PR_FIELDS], cwd);
}

async function fetchChecks(runtime: WorkflowRuntime, cwd: string, prNumber: number): Promise<GitHubCheck[]> {
	const args = ["pr", "checks", String(prNumber), "--json", CHECK_FIELDS];
	const result = await execCommand(runtime, "gh", args, cwd, runtime.signal, COMMAND_TIMEOUT_MS);
	const stdout = result.stdout.trim();
	if (stdout.startsWith("[") || stdout.startsWith("{")) {
		return parseJson<GitHubCheck[]>(result.stdout, "checks", "ci", "CI Checks", "gh", args, cwd);
	}
	if (isLikelyNoChecks(result.stdout, result.stderr)) return [];
	if (stdout) return parseJson<GitHubCheck[]>(result.stdout, "checks", "ci", "CI Checks", "gh", args, cwd);
	if (result.code === 0) return [];
	throw new WorkflowFailure("ci", {
		step: "CI Checks",
		command: "gh",
		args,
		cwd,
		code: result.code,
		stdout: result.stdout,
		stderr: result.stderr,
		message: "Failed to fetch GitHub checks.",
	});
}

async function repoHasDirtyFiles(runtime: WorkflowRuntime, cwd: string): Promise<boolean> {
	const status = await execOrFail(runtime, "commit", "Git status", "git", ["status", "--porcelain"], cwd);
	return hasDirtyFiles(status.stdout);
}

async function ensureSafeStartState(runtime: WorkflowRuntime, currentBranch: string): Promise<void> {
	const cwd = runtime.ctx.cwd;
	await assertNoGitOperationInProgress(runtime, cwd);
	const dirtyGitlinks = await listDirtyGitlinks(runtime, cwd);
	if (dirtyGitlinks.length > 0) {
		throw new WorkflowFailure("branch", {
			step: "Branch",
			command: "git",
			args: ["status", "--porcelain"],
			cwd,
			message: `Cannot run /productionize with dirty gitlinks or nested worktrees: ${dirtyGitlinks.join(", ")}. Restore or commit them first.`,
		});
	}
	if (!PROTECTED_BRANCHES.has(currentBranch)) return;

	const upstream = await branchUpstreamRef(runtime, cwd);
	if (!upstream) {
		throw new WorkflowFailure("branch", {
			step: "Branch",
			command: "git",
			args: ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
			cwd,
			message: `Protected branch ${currentBranch} must track a remote branch before /productionize can branch from it safely.`,
		});
	}
	const ahead = await countCommits(runtime, cwd, `${upstream}..HEAD`);
	if (ahead > 0) {
		throw new WorkflowFailure("branch", {
			step: "Branch",
			command: "git",
			args: ["rev-list", "--count", `${upstream}..HEAD`],
			cwd,
			message: `Protected branch ${currentBranch} has ${ahead} local commit(s) not on ${upstream}. Move them to a feature branch before running /productionize.`,
		});
	}
}

async function assertNoGitOperationInProgress(runtime: WorkflowRuntime, cwd: string): Promise<void> {
	for (const [ref, label] of [
		["MERGE_HEAD", "merge"],
		["CHERRY_PICK_HEAD", "cherry-pick"],
		["REBASE_HEAD", "rebase"],
		["REVERT_HEAD", "revert"],
	] as const) {
		const result = await execCommand(runtime, "git", ["rev-parse", "-q", "--verify", ref], cwd, runtime.signal, 30_000);
		if (result.code !== 0) continue;
		throw new WorkflowFailure("branch", {
			step: "Branch",
			command: "git",
			args: ["rev-parse", "-q", "--verify", ref],
			cwd,
			stdout: result.stdout,
			stderr: result.stderr,
			message: `Cannot run /productionize while a ${label} is in progress.`,
		});
	}
}

async function listDirtyGitlinks(runtime: WorkflowRuntime, cwd: string): Promise<string[]> {
	const status = await execOrFail(runtime, "branch", "Git status", "git", ["status", "--porcelain"], cwd);
	const dirtyPaths = parsePorcelainPaths(status.stdout);
	const dirtyGitlinks: string[] = [];
	for (const path of dirtyPaths) {
		const result = await execCommand(runtime, "git", ["ls-files", "--stage", "--", path], cwd, runtime.signal, 30_000);
		if (result.code === 0 && result.stdout.startsWith("160000 ")) dirtyGitlinks.push(path);
	}
	return dirtyGitlinks;
}

async function branchUpstreamRef(runtime: WorkflowRuntime, cwd: string): Promise<string | undefined> {
	const result = await execCommand(runtime, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd, runtime.signal, 30_000);
	const upstream = result.stdout.trim();
	return result.code === 0 && upstream ? upstream : undefined;
}

async function countCommits(runtime: WorkflowRuntime, cwd: string, range: string): Promise<number> {
	const result = await execOrFail(runtime, "branch", "Count commits", "git", ["rev-list", "--count", range], cwd, 30_000);
	const count = Number.parseInt(result.stdout.trim(), 10);
	return Number.isFinite(count) ? count : 0;
}


async function execOrFail(
	runtime: WorkflowRuntime,
	stepId: StepId,
	step: string,
	command: string,
	args: string[],
	cwd: string,
	timeout = COMMAND_TIMEOUT_MS,
): Promise<ExecResult> {
	const result = await execCommand(runtime, command, args, cwd, runtime.signal, timeout);
	if (result.code !== 0) throw commandFailure(stepId, step, command, args, cwd, result);
	return result;
}

function commandFailure(stepId: StepId, step: string, command: string, args: string[], cwd: string, result: ExecResult): WorkflowFailure {
	return new WorkflowFailure(stepId, {
		step,
		command,
		args,
		cwd,
		code: result.code,
		stdout: result.stdout,
		stderr: result.stderr,
		message: `${command} ${args.join(" ")} exited ${result.code}`,
	});
}

async function execCommand(
	runtime: WorkflowRuntime,
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal,
	timeout = COMMAND_TIMEOUT_MS,
): Promise<ExecResult> {
	if (runtime.hooks.execCommand) return runtime.hooks.execCommand(command, args, cwd, signal, timeout);
	try {
		const result = await runtime.pi.exec(command, args, { cwd, timeout, signal });
		return { code: result.code, stdout: result.stdout, stderr: result.stderr, killed: result.killed };
	} catch (error) {
		if (signal.aborted) throw error;
		return { code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
	}
}

function parseJson<T>(stdout: string, label: string, stepId: StepId, step: string, command: string, args: string[], cwd: string): T {
	try {
		return JSON.parse(stdout) as T;
	} catch (error) {
		throw new WorkflowFailure(stepId, {
			step,
			command,
			args,
			cwd,
			stdout,
			message: `Could not parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

function setStep(state: ProductionizeState, id: StepId, status: StepStatus, detail?: string): void {
	const step = state.steps.find((candidate) => candidate.id === id);
	if (!step) return;
	step.status = status;
	step.detail = detail;
}

export function markRunningCancelled(state: ProductionizeState): void {
	for (const step of state.steps) if (step.status === "running") step.status = "cancelled";
}

function log(state: ProductionizeState, message: string): void {
	state.log.push(`${new Date().toLocaleTimeString()} ${message}`);
	if (state.log.length > 50) state.log.splice(0, state.log.length - 50);
}

export function unknownFailure(stepId: StepId, step: string, error: unknown): WorkflowFailure {
	return new WorkflowFailure(stepId, { step, message: error instanceof Error ? error.message : String(error) });
}

function recentConversationText(ctx: ExtensionContext, limit: number): string {
	const entries = ctx.sessionManager.getBranch();
	const messages: string[] = [];
	for (let i = entries.length - 1; i >= 0 && messages.length < limit; i--) {
		const entry = entries[i];
		if (entry.type !== "message") continue;
		const message = entry.message;
		if (message.role !== "user" && message.role !== "assistant") continue;
		const text = messageText(message);
		if (text.trim()) messages.push(`${message.role}: ${text.trim()}`);
	}
	return messages.reverse().join("\n\n") || "No recent user or assistant messages were available.";
}

function messageText(message: { content: unknown }): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((part) => (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part ? String(part.text) : ""))
		.filter(Boolean)
		.join("\n");
}

function firstPendingStep(state: ProductionizeState): StepId | undefined {
	return state.steps.find((step) => step.status === "pending" || step.status === "running" || step.status === "failed")?.id;
}

function applyStepScope(state: ProductionizeState, options: ProductionizeRunOptions): void {
	if (!options.startFrom || !options.stopAfter) return;
	const startIndex = STEP_ORDER.indexOf(options.startFrom);
	const stopIndex = STEP_ORDER.indexOf(options.stopAfter);
	if (startIndex === -1 || stopIndex === -1) return;
	for (const [index, step] of state.steps.entries()) {
		if (index < startIndex || index > stopIndex) {
			step.status = "skipped";
			step.detail = "Not requested";
		}
	}
}

function nextStep(stepId: StepId): StepId {
	const index = STEP_ORDER.indexOf(stepId);
	return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)] ?? "return";
}


function requiredState<T>(value: T | undefined, message: string): T {
	if (value === undefined || value === null) throw new Error(message);
	return value;
}

function labelForStep(stepId: StepId): string {
	switch (stepId) {
		case "branch":
			return "Branch";
		case "commit":
			return "Commit";
		case "push":
			return "Push";
		case "pr":
			return "Pull Request";
		case "ci":
			return "CI Checks";
		case "merge":
			return "Merge";
		case "return":
			return "Return";
	}
}

function buildProductionizeBranchName(raw: string, hooks: WorkflowHooks): string {
	const sanitized = sanitizeBranchName(raw, "chore/productionize");
	const slug = sanitized.split("/").slice(1).join("-") || "productionize";
	const stamp = timestamp(hooks).replace(/[:.]/g, "-");
	return `productionize/${stamp}-${slug}`.replace(/[/-]+$/g, "");
}

function buildReturnBackupBranch(branch: string, hooks: WorkflowHooks): string {
	const stamp = timestamp(hooks).replace(/[:.]/g, "-");
	return `productionize-backup/${branch}-${stamp}`;
}

function parsePorcelainPaths(statusPorcelain: string): string[] {
	return statusPorcelain
		.split("\n")
		.map((line) => line.trimEnd())
		.filter((line) => line.length >= 4)
		.map((line) => line.slice(3).split(" -> ").at(-1)?.trim())
		.filter((path): path is string => Boolean(path));
}

function failureStatus(state: ProductionizeState, failure: WorkflowFailure): string {
	if (failure.stepId === "return" && state.pr && state.steps.find((step) => step.id === "merge")?.status === "done") {
		return `Productionize merged remotely, but local branch cleanup failed during ${failure.failure.step}.`;
	}
	return `Productionize failed during ${failure.failure.step}.`;
}


function markSuccess(state: ProductionizeState): void {
	state.outcome = "succeeded";
	state.auto.activeCheckpoint = undefined;
	state.auto.resumeFromCheckpoint = undefined;
	state.failure = undefined;
	if (state.pr) {
		state.status = state.returnWarning
			? `Productionize completed: PR merged. ${state.returnWarning}`
			: state.returnToBranch
				? `Productionize completed: PR merged and local checkout returned to ${state.returnToBranch}.`
				: "Productionize completed: PR merged and remote branch deletion requested.";
		log(state, "Workflow completed successfully");
		return;
	}
	state.status = state.returnWarning
		? `Productionize completed: no productionize changes to merge. ${state.returnWarning}`
		: state.returnToBranch
			? `Productionize completed: no productionize changes to merge; local checkout returned to ${state.returnToBranch}.`
			: "Productionize completed: no productionize changes to merge.";
	log(state, "Workflow completed with no PR because no changes were detected");
}

function markScopedSuccess(state: ProductionizeState, stepId: StepId): void {
	state.outcome = "succeeded";
	state.auto.activeCheckpoint = undefined;
	state.auto.resumeFromCheckpoint = undefined;
	state.failure = undefined;
	state.status = `Productionize completed: ${labelForStep(stepId)} step finished.`;
	log(state, `Scoped workflow completed after ${labelForStep(stepId)}`);
}

function stateForFailure(runtime: WorkflowRuntime, failure: WorkflowFailure): void {
	runtime.state.outcome = "failed";
	runtime.state.status = failureStatus(runtime.state, failure);
	runtime.state.failure = failure.failure;
	setStep(runtime.state, failure.stepId, "failed", failure.failure.message ?? "failed");
	log(runtime.state, runtime.state.status);
}

async function persistState(runtime: WorkflowRuntime): Promise<void> {
	if (!runtime.state.auto.enabled) return;
	runtime.state.auto.lastPersistedAt = timestamp(runtime.hooks);
	runtime.pi.appendEntry(PRODUCTIONIZE_STATE_CUSTOM_TYPE, serializeStateEntry(runtime.state as ProductionizeStateSnapshot, runtime.state.auto.lastPersistedAt));
}

async function update(runtime: WorkflowRuntime): Promise<void> {
	if (runtime.state.auto.enabled) await persistState(runtime);
	runtime.render();
}

function timestamp(hooks: WorkflowHooks): string {
	return (hooks.now?.() ?? new Date()).toISOString();
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error("cancelled"));
			return;
		}
		const timeout = setTimeout(resolve, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error("cancelled"));
		};
		signal.addEventListener("abort", onAbort, { once: true });
	});
}
