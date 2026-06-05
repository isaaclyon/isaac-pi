import { complete, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	AUTO_RETRY_LIMIT,
	PRODUCTIONIZE_STATE_CUSTOM_TYPE,
	PRODUCTIONIZE_SUMMARY_MESSAGE_TYPE,
	buildRetryKey,
	createDefaultSnapshot,
	decideResumePlan,
	invalidateForResume,
	recordRetryAttempt,
	serializeStateEntry,
	serializeSummaryEntry,
	type ActiveRepairState,
	type ProductionizeStateSnapshot,
	type RepairSummaryEntry,
} from "./auto.ts";
import {
	buildFailurePrompt,
	buildPrBody,
	checkLabel,
	evaluateChecks,
	fallbackFixInstruction,
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
import { cleanupRepairArtifacts, createRepairRunner, type RepairAttemptSummary, type RepairRunner } from "./repair-runner.ts";
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
const SUMMARY_FIELDS = "state,mergedAt";
const STEP_ORDER: StepId[] = ["branch", "commit", "push", "pr", "ci", "merge", "return"];
const COMMIT_DOWNSTREAM: StepId[] = ["push", "pr", "ci", "merge", "return"];

export interface ProductionizeRunOptions {
	auto?: boolean;
}

export interface WorkflowHooks {
	repairRunnerFactory?: () => RepairRunner;
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
	repairRunner: RepairRunner;
}

interface StepResult {
	next?: StepId;
	finished?: true;
}

export function createInitialState(options: ProductionizeRunOptions = {}): ProductionizeState {
	return createDefaultSnapshot(Boolean(options.auto));
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
	const runtime: WorkflowRuntime = {
		pi,
		ctx,
		state,
		signal,
		render,
		hooks,
		repairRunner: hooks.repairRunnerFactory?.() ?? createRepairRunner(),
	};

	try {
		if (state.auto.enabled) {
			state.auto.startTimestamp ??= timestamp(hooks);
			await persistState(runtime);
		}

		if (state.auto.enabled && shouldReconcileRepair(state)) {
			const recovered = await reconcileActiveRepair(runtime);
			if (!recovered) return;
		}

		let currentStep = state.auto.resumeFromCheckpoint ?? firstPendingStep(state) ?? "branch";
		while (true) {
			if (signal.aborted || state.cancelRequested) throw new Error("cancelled");
			state.auto.activeCheckpoint = currentStep;
			state.auto.resumeFromCheckpoint = currentStep;
			await persistState(runtime);
			render();

			try {
				const result = await runStep(runtime, currentStep);
				if (result.finished) {
					markSuccess(state);
					if (state.auto.enabled) await persistState(runtime);
					render();
					return;
				}
				currentStep = result.next ?? nextStep(currentStep);
				continue;
			} catch (error) {
				if (signal.aborted || state.cancelRequested) throw error;
				const failure = error instanceof WorkflowFailure ? error : unknownFailure(currentStep, labelForStep(currentStep), error);
				if (state.auto.enabled) {
					const recovered = await attemptAutoRepair(runtime, failure);
					if (recovered) {
						currentStep = state.auto.resumeFromCheckpoint ?? currentStep;
						continue;
					}
				}
				throw failure;
			}
		}
	} catch (error) {
		if (signal.aborted || state.cancelRequested) {
			state.outcome = "cancelled";
			state.status = "Productionize cancelled.";
			markRunningCancelled(state);
			state.auto.currentRepair = undefined;
			if (state.auto.enabled) await persistState(runtime);
			render();
			return;
		}

		const failure = error instanceof WorkflowFailure ? error : unknownFailure(state.auto.activeCheckpoint ?? "branch", "Workflow", error);
		state.outcome = "failed";
		state.status = `Productionize failed during ${failure.failure.step}.`;
		state.failure = failure.failure;
		setStep(state, failure.stepId, "failed", failure.failure.message ?? "failed");
		state.auto.currentRepair = undefined;
		if (state.auto.enabled) {
			await persistState(runtime);
			render();
			return;
		}
		render();
		state.fixInstruction = await generateFixInstruction(runtime, failure.failure);
		log(state, "Generated fix instruction preview");
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

	if (!PROTECTED_BRANCHES.has(currentBranch)) {
		state.branch = currentBranch;
		setStep(state, "branch", "done", `Reusing ${currentBranch}`);
		log(state, `Reusing branch ${currentBranch}`);
		await update(runtime);
		return;
	}

	const branchName = sanitizeBranchName(
		await completeSparkWithHooks(
			runtime,
			"Generate one git branch name. Output only the branch name.",
			`Use a conventional prefix such as feat/, fix/, chore/, docs/, test/, or refactor/. Use lowercase kebab-case. Base it on these recent Pi user/assistant messages:\n\n${recentConversationText(ctx, 10)}`,
			"chore/productionize",
		),
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

	setStep(state, "return", "running", `Pulling ${remote}/${branch}`);
	state.status = `Pulling latest ${branch} from ${remote}...`;
	await update(runtime);
	const pullArgs = ["pull", "--ff-only", remote, branch];
	const pull = await execCommand(runtime, "git", pullArgs, cwd, runtime.signal, 180_000);
	if (pull.code !== 0) {
		if (!isLikelyNonFastForwardPull(pull.stdout, pull.stderr)) {
			throw commandFailure("return", "Pull base branch", "git", pullArgs, cwd, pull);
		}
		state.returnWarning = `Local ${branch} diverged from ${remote}/${branch}; skipped fast-forward pull.`;
		setStep(state, "return", "done", `Returned to ${branch}; pull skipped`);
		log(state, state.returnWarning);
		await update(runtime);
		return;
	}

	setStep(state, "return", "done", `Updated ${branch}`);
	log(state, `Returned to ${branch} and pulled ${remote}/${branch}`);
	await update(runtime);
}

async function attemptAutoRepair(runtime: WorkflowRuntime, failure: WorkflowFailure): Promise<boolean> {
	const classification = classifyFailure(failure.failure);
	if (classification === "unrecoverable") {
		stateForFailure(runtime, failure);
		return false;
	}

	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	const headShaBefore = await revParse(runtime, cwd, "HEAD");
	const baseBranch = state.baseBranch ?? (await detectDefaultBranch(runtime, cwd));
	state.baseBranch = baseBranch;
	const retryKey = buildRetryKey(failure.stepId, headShaBefore);
	const attempt = (state.auto.retryCounts[retryKey] ?? 0) + 1;
	if (attempt > AUTO_RETRY_LIMIT) {
		state.failure = {
			...failure.failure,
			message: `Auto repair exhausted ${AUTO_RETRY_LIMIT} attempts for ${retryKey}.`,
		};
		state.outcome = "failed";
		state.status = state.failure.message;
		state.auto.currentRepair = undefined;
		setStep(state, failure.stepId, "failed", state.failure.message);
		log(state, state.failure.message);
		await persistState(runtime);
		return false;
	}

	const prompt = buildRepairPrompt(state, failure.failure, failure.stepId, headShaBefore, attempt);
	state.auto.latestHandoffPrompt = prompt;
	state.auto.retryCounts = recordRetryAttempt(state.auto.retryCounts, retryKey);
	state.auto.currentRepair = {
		stepId: failure.stepId,
		attempt,
		maxAttempts: AUTO_RETRY_LIMIT,
		status: "starting",
		headShaBefore,
		baseBranch,
		sessionFile: state.auto.latestSideSessionFile,
		lastPrompt: prompt,
	};
	state.status = `Starting repair attempt ${attempt}/${AUTO_RETRY_LIMIT} for ${failure.stepId}...`;
	log(state, state.status);
	await persistState(runtime);
	await update(runtime);

	const summary = await runRepairAttempt(runtime, failure.stepId, prompt, attempt);
	return await resumeAfterRepair(runtime, failure.stepId, summary);
}

async function reconcileActiveRepair(runtime: WorkflowRuntime): Promise<boolean> {
	const repair = stateRepair(runtime.state);
	if (!repair) return true;
	const prompt = repair.lastPrompt;
	if (!prompt) {
		runtime.state.auto.currentRepair = undefined;
		return true;
	}
	const stepId = repair.stepId;
	const summary = await runRepairAttempt(runtime, stepId, prompt, repair.attempt, repair);
	return await resumeAfterRepair(runtime, stepId, summary);
}

async function runRepairAttempt(
	runtime: WorkflowRuntime,
	stepId: StepId,
	prompt: string,
	attempt: number,
	previousRepair?: ActiveRepairState,
): Promise<RepairAttemptSummary> {
	const { state, ctx, signal } = runtime;
	const cwd = ctx.cwd;
	const branch = requiredState(state.branch, "Auto repair requires current branch state.");
	const baseBranch = state.baseBranch ?? (await detectDefaultBranch(runtime, cwd));
	let summary: RepairAttemptSummary | undefined;
	try {
		summary = await runtime.repairRunner.start(
			{ cwd, stepId, branch, baseBranch, prompt, model: modelSpecifier(ctx), abortSignal: signal, previousRepair },
			(update) => {
				const current = state.auto.currentRepair;
				if (!current) return;
				state.auto.currentRepair = {
					...current,
					status: current.status === "starting" ? "running" : current.status,
					sessionFile: update.sessionFile ?? current.sessionFile,
					childToken: update.childToken ?? current.childToken,
					spawnTimestamp: update.spawnTimestamp ?? current.spawnTimestamp,
					pid: update.pid ?? current.pid,
					verifiedCommand: update.verifiedCommand ?? current.verifiedCommand,
					tempWorktree: update.tempWorktree ?? current.tempWorktree,
					lastSeenEventType: update.lastSeenEventType ?? current.lastSeenEventType,
					lastSummarizedText: update.lastSummarizedText ?? current.lastSummarizedText,
				};
				state.auto.latestSideSessionFile = state.auto.currentRepair.sessionFile;
				void persistState(runtime);
				runtime.render();
			},
		);
		return summary;
	} finally {
		if (summary?.sessionFile) state.auto.latestSideSessionFile = summary.sessionFile;
	}
}

async function resumeAfterRepair(runtime: WorkflowRuntime, failedStepId: StepId, summary: RepairAttemptSummary): Promise<boolean> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	try {
		state.auto.currentRepair = {
			stepId: failedStepId,
			attempt: state.auto.currentRepair?.attempt ?? 1,
			maxAttempts: AUTO_RETRY_LIMIT,
			status: summary.outcome === "cancelled" ? "cancelled" : "importing",
			headShaBefore: summary.headShaBefore,
			baseBranch: summary.baseBranch,
			baseShaBefore: summary.baseShaBefore,
			sessionFile: summary.sessionFile,
			childToken: summary.childToken,
			spawnTimestamp: summary.spawnTimestamp,
			verifiedCommand: summary.verifiedCommand,
			tempWorktree: summary.tempWorktree,
			lastSeenEventType: summary.lastSeenEventType,
			lastSummarizedText: summary.lastSummarizedText,
		};
		await appendRepairSummary(runtime, summary, state.auto.currentRepair.attempt);
		if (summary.outcome === "cancelled") {
			state.cancelRequested = true;
			state.status = "Productionize cancelled during auto repair.";
			state.auto.currentRepair = undefined;
			await persistState(runtime);
			return false;
		}
		if (summary.outcome === "failed") {
			state.outcome = "failed";
			state.failure = {
				step: labelForStep(failedStepId),
				message: summary.summary,
			};
			state.status = summary.summary;
			state.auto.currentRepair = undefined;
			setStep(state, failedStepId, "failed", summary.summary);
			log(state, summary.summary);
			await persistState(runtime);
			await update(runtime);
			return false;
		}

		await verifyResumeSafety(runtime, summary.baseBranch, summary.baseShaBefore);
		if (summary.patch.trim()) {
			await importRepairPatch(runtime, summary.patchFile);
		}
		const hasDirty = await repoHasDirtyFiles(runtime, cwd);
		let plan = decideResumePlan(failedStepId, false);
		if (hasDirty && failedStepId !== "branch") {
			plan = { resumeFrom: "commit", clearSteps: [...COMMIT_DOWNSTREAM], clearPr: true, clearChecks: true };
		}
		const nextState = invalidateForResume(state, plan) as ProductionizeState;
		Object.assign(state, nextState);
		state.auto.currentRepair = {
			...(state.auto.currentRepair ?? { stepId: failedStepId, attempt: 1, maxAttempts: AUTO_RETRY_LIMIT, status: "resuming" as const }),
			status: "resuming",
			resumeCheckpoint: plan.resumeFrom,
		};
		state.status = `Resuming from ${plan.resumeFrom} after repair attempt ${state.auto.currentRepair.attempt}/${AUTO_RETRY_LIMIT}...`;
		state.failure = undefined;
		state.outcome = "running";
		log(state, state.status);
		await persistState(runtime);
		await update(runtime);
		return true;
	} finally {
		await cleanupRepairArtifacts(summary).catch(() => undefined);
	}
}

async function verifyResumeSafety(runtime: WorkflowRuntime, baseBranch: string, baseShaBefore: string): Promise<void> {
	const { state, ctx } = runtime;
	const cwd = ctx.cwd;
	const baseShaAfter = await revParse(runtime, cwd, baseBranch);
	if (baseShaAfter !== baseShaBefore) {
		throw new WorkflowFailure(state.auto.activeCheckpoint ?? "branch", {
			step: labelForStep(state.auto.activeCheckpoint ?? "branch"),
			message: `Auto repair stopped because base branch ${baseBranch} advanced during repair.`,
		});
	}
	if (!state.pr) return;
	const result = await execOrFail(runtime, "pr", "Inspect PR merge state", "gh", ["pr", "view", String(state.pr.number), "--json", SUMMARY_FIELDS], cwd);
	const data = parseJson<{ state?: string; mergedAt?: string | null }>(result.stdout, "PR state", "pr", "Pull Request", "gh", ["pr", "view", String(state.pr.number), "--json", SUMMARY_FIELDS], cwd);
	if (data.mergedAt || (data.state && data.state.toUpperCase() !== "OPEN")) {
		throw new WorkflowFailure(state.auto.activeCheckpoint ?? "pr", {
			step: "Pull Request",
			message: "Auto repair stopped because the pull request is no longer open.",
		});
	}
}

async function importRepairPatch(runtime: WorkflowRuntime, patchFile: string): Promise<void> {
	const { ctx } = runtime;
	const cwd = ctx.cwd;
	const result = await execCommand(runtime, "git", ["apply", "--index", "--3way", patchFile], cwd, runtime.signal, COMMAND_TIMEOUT_MS);
	if (result.code !== 0) {
		throw new WorkflowFailure(runtime.state.auto.activeCheckpoint ?? "commit", {
			step: labelForStep(runtime.state.auto.activeCheckpoint ?? "commit"),
			command: "git",
			args: ["apply", "--index", "--3way", patchFile],
			cwd,
			code: result.code,
			stdout: result.stdout,
			stderr: result.stderr,
			message: "Failed to import repair patch.",
		});
	}
}

function classifyFailure(failure: CommandFailure): "recoverable" | "unrecoverable" {
	const stderr = `${failure.stderr ?? ""}\n${failure.stdout ?? ""}\n${failure.message ?? ""}`.toLowerCase();
	const args = failure.args?.join(" ") ?? "";
	if (failure.command === "git" && args.includes("rev-parse --is-inside-work-tree")) return "unrecoverable";
	if (failure.command === "git" && args.includes("branch --show-current") && !failure.stdout?.trim()) return "unrecoverable";
	if (stderr.includes("detached head")) return "unrecoverable";
	if (failure.command === "gh" && /auth|not logged in|authentication required|gh auth login/.test(stderr)) return "unrecoverable";
	if (stderr.includes("no git remote is configured") || stderr.includes("no remote configured")) return "unrecoverable";
	if (failure.command === "gh" && /not a github repository|no git remotes configured/.test(stderr)) return "unrecoverable";
	return failure.step !== "Branch" ? "recoverable" : "unrecoverable";
}

function buildRepairPrompt(state: ProductionizeState, failure: CommandFailure, stepId: StepId, headShaBefore: string, attempt: number): string {
	const context = buildFailurePrompt(failure, {
		branch: state.branch,
		remote: state.remote,
		prUrl: state.pr?.url,
		checks: state.checks,
		recentLog: state.log,
	});
	return [
		`You are fixing a /productionize auto repair handoff for step ${stepId}.`,
		"Work only in the current temporary worktree using read/edit/write tools.",
		"Do not run /productionize, do not try to push, and do not use GitHub commands.",
		"Make the smallest code or file changes needed to address the failure.",
		"When done, stop after a concise summary of what you changed.",
		`Attempt: ${attempt}/${AUTO_RETRY_LIMIT}`,
		`Current branch: ${state.branch ?? "unknown"}`,
		`Current HEAD before repair: ${headShaBefore}`,
		"Foreground productionize will import your patch, rerun the safe checkpoint, and verify the result itself.",
		"Resume rules: branch->branch, commit->commit, push->push, pr->pr, ci/merge/return rerun from the nearest safe checkpoint after import.",
		"",
		context,
	].join("\n");
}

async function appendRepairSummary(runtime: WorkflowRuntime, summary: RepairAttemptSummary, attempt: number): Promise<void> {
	const entry: RepairSummaryEntry = {
		stepId: summary.stepId,
		attempt,
		headShaBefore: summary.headShaBefore,
		outcome: summary.outcome,
		sessionFile: summary.sessionFile,
		persistedAt: timestamp(runtime.hooks),
		summary: summary.summary,
	};
	runtime.state.auto.lastRepairSummary = entry;
	runtime.state.auto.repairHistory = [...runtime.state.auto.repairHistory, entry];
	runtime.state.auto.latestSideSessionFile = summary.sessionFile;
	runtime.pi.appendEntry(PRODUCTIONIZE_STATE_CUSTOM_TYPE, serializeSummaryEntry(entry, entry.persistedAt));
	runtime.pi.sendMessage({
		customType: PRODUCTIONIZE_SUMMARY_MESSAGE_TYPE,
		content: `${summary.summary}\nSide session: ${summary.sessionFile}`,
		display: true,
		details: entry,
	});
}

async function generateFixInstruction(runtime: WorkflowRuntime, failure: CommandFailure): Promise<string> {
	const prompt = buildFailurePrompt(failure, {
		branch: runtime.state.branch,
		remote: runtime.state.remote,
		prUrl: runtime.state.pr?.url,
		checks: runtime.state.checks,
		recentLog: runtime.state.log,
	});
	try {
		return await completeSparkWithHooks(runtime, "You write concise repair instructions for a coding agent. Output only the instruction to paste into Pi.", prompt, fallbackFixInstruction(failure));
	} catch {
		return fallbackFixInstruction(failure);
	}
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

	const message: Message = {
		role: "user",
		content: [{ type: "text", text: userText }],
		timestamp: Date.now(),
	};
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

async function revParse(runtime: WorkflowRuntime, cwd: string, rev: string): Promise<string> {
	const result = await execOrFail(runtime, "branch", "Resolve revision", "git", ["rev-parse", rev], cwd);
	return result.stdout.trim();
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

function nextStep(stepId: StepId): StepId {
	const index = STEP_ORDER.indexOf(stepId);
	return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)] ?? "return";
}

function shouldReconcileRepair(state: ProductionizeState): boolean {
	const repair = state.auto.currentRepair;
	return Boolean(repair && ["starting", "running", "importing", "resuming"].includes(repair.status));
}

function stateRepair(state: ProductionizeState): ActiveRepairState | undefined {
	return state.auto.currentRepair;
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

function modelSpecifier(ctx: ExtensionContext): string | undefined {
	return ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined;
}

function markSuccess(state: ProductionizeState): void {
	state.outcome = "succeeded";
	state.auto.currentRepair = undefined;
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

function stateForFailure(runtime: WorkflowRuntime, failure: WorkflowFailure): void {
	runtime.state.outcome = "failed";
	runtime.state.status = `Productionize failed during ${failure.failure.step}.`;
	runtime.state.failure = failure.failure;
	setStep(runtime.state, failure.stepId, "failed", failure.failure.message ?? "failed");
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
