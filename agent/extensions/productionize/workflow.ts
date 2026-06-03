import { complete, type Message } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
	buildFailurePrompt,
	buildPrBody,
	checkLabel,
	cloneDefaultSteps,
	evaluateChecks,
	fallbackFixInstruction,
	hasDirtyFiles,
	hasPrChanges,
	isLikelyNoChecks,
	isLikelyNoPr,
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

export function createInitialState(): ProductionizeState {
	return {
		steps: cloneDefaultSteps(),
		checks: [],
		log: [],
		outcome: "running",
		status: "Starting productionize...",
		changedFiles: [],
		cancelRequested: false,
	};
}

export async function runWorkflow(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	state: ProductionizeState,
	signal: AbortSignal,
	render: () => void,
): Promise<void> {
	try {
		const cwd = ctx.cwd;
		const branch = await runBranchStep(pi, ctx, state, cwd, signal, render);
		await runCommitStep(pi, ctx, state, cwd, signal, render);
		const remote = await runPushStep(pi, state, cwd, branch, signal, render);
		const pr = await runPrStep(pi, ctx, state, cwd, branch, remote, signal, render);
		if (!pr) {
			await runReturnStep(pi, state, cwd, remote, signal, render);
			state.outcome = "succeeded";
			state.status = state.returnToBranch
				? `Productionize completed: no productionize changes to merge; local checkout returned to ${state.returnToBranch}.`
				: "Productionize completed: no productionize changes to merge.";
			log(state, "Workflow completed with no PR because no changes were detected");
			render();
			return;
		}
		await runCiStep(pi, state, cwd, pr, signal, render);
		await runMergeStep(pi, state, cwd, pr, signal, render);
		await runReturnStep(pi, state, cwd, remote, signal, render);
		state.outcome = "succeeded";
		state.status = state.returnToBranch
			? `Productionize completed: PR merged and local checkout returned to ${state.returnToBranch}.`
			: "Productionize completed: PR merged and remote branch deletion requested.";
		log(state, "Workflow completed successfully");
		render();
	} catch (error) {
		if (signal.aborted || state.cancelRequested) {
			state.outcome = "cancelled";
			state.status = "Productionize cancelled.";
			markRunningCancelled(state);
			render();
			return;
		}

		const failure = error instanceof WorkflowFailure ? error : unknownFailure("branch", "Workflow", error);
		state.outcome = "failed";
		state.status = `Productionize failed during ${failure.failure.step}.`;
		state.failure = failure.failure;
		setStep(state, failure.stepId, "failed", failure.failure.message ?? "failed");
		render();

		state.fixInstruction = await generateFixInstruction(pi, ctx, state, failure.failure, signal);
		log(state, "Generated fix instruction preview");
		render();
	}
}

async function runBranchStep(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	state: ProductionizeState,
	cwd: string,
	signal: AbortSignal,
	render: () => void,
): Promise<string> {
	setStep(state, "branch", "running", "Checking current branch");
	state.status = "Checking git branch...";
	render();

	await execOrFail(pi, "branch", "Repository check", "git", ["rev-parse", "--is-inside-work-tree"], cwd, signal);
	const currentResult = await execOrFail(pi, "branch", "Current branch", "git", ["branch", "--show-current"], cwd, signal);
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
		render();
		return currentBranch;
	}

	const branchName = sanitizeBranchName(
		await completeSpark(
			ctx,
			"Generate one git branch name. Output only the branch name.",
			`Use a conventional prefix such as feat/, fix/, chore/, docs/, test/, or refactor/. Use lowercase kebab-case. Base it on these recent Pi user/assistant messages:\n\n${recentConversationText(ctx, 10)}`,
			"chore/productionize",
			signal,
		),
	);

	state.baseBranch = currentBranch;
	state.returnToBranch = currentBranch;
	if (await localBranchExists(pi, cwd, branchName, signal)) {
		setStep(state, "branch", "running", `Switching to existing ${branchName}`);
		state.status = `Switching to existing branch ${branchName}...`;
		render();
		await execOrFail(pi, "branch", "Switch branch", "git", ["checkout", branchName], cwd, signal);
		state.branch = branchName;
		setStep(state, "branch", "done", `Reused ${branchName}`);
		log(state, `Switched to existing branch ${branchName}`);
		render();
		return branchName;
	}

	setStep(state, "branch", "running", `Creating ${branchName}`);
	state.status = `Creating branch ${branchName}...`;
	render();
	await execOrFail(pi, "branch", "Create branch", "git", ["checkout", "-b", branchName], cwd, signal);
	state.branch = branchName;
	setStep(state, "branch", "done", `Created ${branchName}`);
	log(state, `Created branch ${branchName}`);
	render();
	return branchName;
}

async function runCommitStep(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	state: ProductionizeState,
	cwd: string,
	signal: AbortSignal,
	render: () => void,
): Promise<void> {
	setStep(state, "commit", "running", "Checking dirty files");
	state.status = "Checking dirty files...";
	render();

	const status = await execOrFail(pi, "commit", "Git status", "git", ["status", "--porcelain"], cwd, signal);
	if (!hasDirtyFiles(status.stdout)) {
		setStep(state, "commit", "done", "No dirty files");
		log(state, "No dirty files to commit");
		render();
		return;
	}

	await execOrFail(pi, "commit", "Stage files", "git", ["add", "-A"], cwd, signal);
	const nameStatus = await execOrFail(pi, "commit", "Staged file list", "git", ["diff", "--cached", "--name-status"], cwd, signal);
	const stat = await execOrFail(pi, "commit", "Staged diff stat", "git", ["diff", "--cached", "--stat"], cwd, signal);
	state.changedFiles = parseNameStatus(nameStatus.stdout);

	const subject = sanitizeCommitSubject(
		await completeSpark(
			ctx,
			"Generate one Conventional Commit subject. Output only the subject line.",
			`Create a concise commit subject for these staged changes.\n\nStatus:\n${nameStatus.stdout}\n\nStat:\n${stat.stdout}`,
			"chore: productionize changes",
			signal,
		),
	);

	setStep(state, "commit", "running", subject);
	state.status = "Committing dirty files...";
	render();
	await execOrFail(pi, "commit", "Commit", "git", ["commit", "-m", subject], cwd, signal);
	setStep(state, "commit", "done", subject);
	log(state, `Committed changes: ${subject}`);
	render();
}

async function runPushStep(
	pi: ExtensionAPI,
	state: ProductionizeState,
	cwd: string,
	branch: string,
	signal: AbortSignal,
	render: () => void,
): Promise<string> {
	setStep(state, "push", "running", "Detecting upstream");
	state.status = "Pushing branch...";
	render();

	const upstream = await execCommand(pi, "git", ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd, signal, 30_000);
	if (upstream.code === 0 && upstream.stdout.trim()) {
		const remote = upstream.stdout.trim().split("/")[0] ?? "origin";
		state.remote = remote;
		await execOrFail(pi, "push", "Push", "git", ["push"], cwd, signal);
		setStep(state, "push", "done", `Pushed to ${upstream.stdout.trim()}`);
		log(state, `Pushed to existing upstream ${upstream.stdout.trim()}`);
		render();
		return remote;
	}

	const remote = await choosePushRemote(pi, cwd, branch, signal);
	state.remote = remote;
	await execOrFail(pi, "push", "Push with upstream", "git", ["push", "-u", remote, branch], cwd, signal);
	setStep(state, "push", "done", `Pushed to ${remote}/${branch}`);
	log(state, `Pushed and set upstream ${remote}/${branch}`);
	render();
	return remote;
}

async function runPrStep(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	state: ProductionizeState,
	cwd: string,
	branch: string,
	remote: string,
	signal: AbortSignal,
	render: () => void,
): Promise<PrInfo | undefined> {
	setStep(state, "pr", "running", "Preparing PR");
	state.status = "Opening pull request...";
	render();

	const base = state.baseBranch ?? (await detectDefaultBranch(pi, cwd, signal));
	state.baseBranch = base;
	const prDelta = await inspectPrDelta(pi, cwd, remote, base, signal);
	state.changedFiles = prDelta.files;
	if (!prDelta.hasChanges) {
		setStep(state, "pr", "skipped", "No changes to merge");
		setStep(state, "ci", "skipped", "No PR: no changes detected");
		setStep(state, "merge", "skipped", "No PR: no changes detected");
		state.status = "No productionize changes to merge.";
		log(state, `Skipped PR creation because ${branch} has no commits or file changes relative to ${base}`);
		render();
		return undefined;
	}
	const body = buildPrBody(state.changedFiles, { branch, base });
	const title = sanitizePrTitle(
		await completeSpark(
			ctx,
			"Generate one GitHub pull request title. Output only the title.",
			`Create a concise PR title for this branch and changed-file list.\n\nBranch: ${branch}\nBase: ${base}\n\n${body}`,
			"Productionize changes",
			signal,
		),
	);

	const existing = await execCommand(pi, "gh", ["pr", "view", "--json", PR_FIELDS], cwd, signal, COMMAND_TIMEOUT_MS);
	let pr: PrInfo;
	if (existing.code === 0) {
		pr = parseJson<PrInfo>(existing.stdout, "existing PR", "pr", "Pull Request", "gh", ["pr", "view", "--json", PR_FIELDS], cwd);
		await execOrFail(pi, "pr", "Update PR", "gh", ["pr", "edit", String(pr.number), "--title", title, "--body", body], cwd, signal);
		pr = await fetchPrInfo(pi, cwd, signal);
		log(state, `Updated existing PR #${pr.number}`);
	} else if (isLikelyNoPr(existing.stdout, existing.stderr)) {
		await execOrFail(pi, "pr", "Create PR", "gh", ["pr", "create", "--base", base, "--head", branch, "--title", title, "--body", body], cwd, signal, 180_000);
		pr = await fetchPrInfo(pi, cwd, signal);
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
	render();
	return pr;
}

async function runCiStep(
	pi: ExtensionAPI,
	state: ProductionizeState,
	cwd: string,
	pr: PrInfo,
	signal: AbortSignal,
	render: () => void,
): Promise<void> {
	setStep(state, "ci", "running", "Waiting for checks");
	state.status = "Polling GitHub checks...";
	render();

	const started = Date.now();
	while (Date.now() - started < CHECK_TIMEOUT_MS) {
		if (signal.aborted) throw new Error("cancelled");
		const checks = await fetchChecks(pi, cwd, pr.number, signal);
		const evaluation = evaluateChecks(checks);
		state.checks = [...evaluation.passed, ...evaluation.pending, ...evaluation.failed, ...evaluation.skipped].sort((a, b) => checkLabel(a).localeCompare(checkLabel(b)));
		if (evaluation.status === "passed") {
			setStep(state, "ci", "done", `${evaluation.passed.length} check(s) passed`);
			log(state, `${evaluation.passed.length} GitHub check(s) passed`);
			render();
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
			render();
			return;
		}
		setStep(state, "ci", "running", discovered === 0 ? "No checks discovered yet" : `${pendingCount} pending`);
		log(state, discovered === 0 ? "No GitHub checks discovered yet" : `Waiting for ${pendingCount} pending check(s)`);
		render();
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

async function runMergeStep(
	pi: ExtensionAPI,
	state: ProductionizeState,
	cwd: string,
	pr: PrInfo,
	signal: AbortSignal,
	render: () => void,
): Promise<void> {
	setStep(state, "merge", "running", "Squash merging");
	state.status = "Squash merging PR and deleting remote branch...";
	render();

	const mergeArgs = ["pr", "merge", String(pr.number), "--squash", "--delete-branch", "--match-head-commit", pr.headRefOid, "--subject", pr.title, "--body", ""];
	const result = await execCommand(pi, "gh", mergeArgs, cwd, signal, 180_000);
	if (result.code !== 0) {
		const usedWorktree = parseBranchUsedByWorktreeError(result.stdout, result.stderr);
		if (!usedWorktree || (usedWorktree.branch !== state.baseBranch && !PROTECTED_BRANCHES.has(usedWorktree.branch))) {
			throw commandFailure("merge", "Squash merge", "gh", mergeArgs, cwd, result);
		}

		setStep(state, "merge", "running", `Retrying from ${usedWorktree.branch} worktree`);
		log(state, `Retrying merge from worktree ${usedWorktree.path}`);
		render();
		const retry = await execCommand(pi, "gh", mergeArgs, usedWorktree.path, signal, 180_000);
		if (retry.code !== 0) {
			throw commandFailure("merge", "Squash merge", "gh", mergeArgs, usedWorktree.path, retry);
		}
	}
	setStep(state, "merge", "done", "Squash merged; delete branch requested");
	log(state, `Merged PR #${pr.number}`);
	render();
}

async function runReturnStep(
	pi: ExtensionAPI,
	state: ProductionizeState,
	cwd: string,
	remote: string,
	signal: AbortSignal,
	render: () => void,
): Promise<void> {
	const branch = state.returnToBranch;
	if (!branch) {
		setStep(state, "return", "skipped", "Started on existing branch");
		render();
		return;
	}

	setStep(state, "return", "running", `Switching to ${branch}`);
	state.status = `Switching back to ${branch}...`;
	render();
	await execOrFail(pi, "return", "Return to base branch", "git", ["switch", branch], cwd, signal);
	state.branch = branch;

	setStep(state, "return", "running", `Pulling ${remote}/${branch}`);
	state.status = `Pulling latest ${branch} from ${remote}...`;
	render();
	await execOrFail(pi, "return", "Pull base branch", "git", ["pull", "--ff-only", remote, branch], cwd, signal, 180_000);

	setStep(state, "return", "done", `Updated ${branch}`);
	log(state, `Returned to ${branch} and pulled ${remote}/${branch}`);
	render();
}

async function localBranchExists(pi: ExtensionAPI, cwd: string, branch: string, signal: AbortSignal): Promise<boolean> {
	const result = await execCommand(pi, "git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], cwd, signal, 30_000);
	return result.code === 0;
}

async function choosePushRemote(pi: ExtensionAPI, cwd: string, branch: string, signal: AbortSignal): Promise<string> {
	const configured = await execCommand(pi, "git", ["config", `branch.${branch}.remote`], cwd, signal, 30_000);
	if (configured.code === 0 && configured.stdout.trim() && configured.stdout.trim() !== ".") return configured.stdout.trim();

	const remotes = await execOrFail(pi, "push", "List remotes", "git", ["remote"], cwd, signal, 30_000);
	const names = remotes.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
	if (names.includes("origin")) return "origin";
	if (names[0]) return names[0];
	throw new WorkflowFailure("push", { step: "Push", command: "git", args: ["remote"], cwd, stdout: remotes.stdout, stderr: remotes.stderr, message: "No git remote is configured." });
}

async function detectDefaultBranch(pi: ExtensionAPI, cwd: string, signal: AbortSignal): Promise<string> {
	const result = await execOrFail(pi, "pr", "Detect default branch", "gh", ["repo", "view", "--json", "defaultBranchRef"], cwd, signal);
	const data = parseJson<{ defaultBranchRef?: { name?: string } }>(result.stdout, "default branch", "pr", "Pull Request", "gh", ["repo", "view", "--json", "defaultBranchRef"], cwd);
	return data.defaultBranchRef?.name || "main";
}

async function inspectPrDelta(
	pi: ExtensionAPI,
	cwd: string,
	remote: string,
	base: string,
	signal: AbortSignal,
): Promise<{ files: ChangedFile[]; commitCount: number; hasChanges: boolean }> {
	await execOrFail(pi, "pr", "Fetch PR base", "git", ["fetch", remote, base], cwd, signal, 180_000);
	const diff = await execOrFail(pi, "pr", "Changed files", "git", ["diff", "--name-status", "FETCH_HEAD...HEAD"], cwd, signal, COMMAND_TIMEOUT_MS);
	const commits = await execOrFail(pi, "pr", "Changed commit count", "git", ["rev-list", "--count", "FETCH_HEAD..HEAD"], cwd, signal, COMMAND_TIMEOUT_MS);
	const files = parseNameStatus(diff.stdout);
	const commitCount = Number.parseInt(commits.stdout.trim(), 10);
	const safeCommitCount = Number.isFinite(commitCount) ? commitCount : files.length;
	return {
		files,
		commitCount: safeCommitCount,
		hasChanges: hasPrChanges(files, safeCommitCount),
	};
}

async function fetchPrInfo(pi: ExtensionAPI, cwd: string, signal: AbortSignal): Promise<PrInfo> {
	const result = await execOrFail(pi, "pr", "Fetch PR", "gh", ["pr", "view", "--json", PR_FIELDS], cwd, signal);
	return parseJson<PrInfo>(result.stdout, "PR", "pr", "Pull Request", "gh", ["pr", "view", "--json", PR_FIELDS], cwd);
}

async function fetchChecks(pi: ExtensionAPI, cwd: string, prNumber: number, signal: AbortSignal): Promise<GitHubCheck[]> {
	const args = ["pr", "checks", String(prNumber), "--json", CHECK_FIELDS];
	const result = await execCommand(pi, "gh", args, cwd, signal, COMMAND_TIMEOUT_MS);
	const stdout = result.stdout.trim();
	if (stdout.startsWith("[") || stdout.startsWith("{")) {
		return parseJson<GitHubCheck[]>(result.stdout, "checks", "ci", "CI Checks", "gh", args, cwd);
	}
	if (isLikelyNoChecks(result.stdout, result.stderr)) return [];
	if (stdout) {
		return parseJson<GitHubCheck[]>(result.stdout, "checks", "ci", "CI Checks", "gh", args, cwd);
	}
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

async function generateFixInstruction(
	pi: ExtensionAPI,
	ctx: ExtensionCommandContext,
	state: ProductionizeState,
	failure: CommandFailure,
	signal: AbortSignal,
): Promise<string> {
	const prompt = buildFailurePrompt(failure, {
		branch: state.branch,
		remote: state.remote,
		prUrl: state.pr?.url,
		checks: state.checks,
		recentLog: state.log,
	});
	try {
		return await completeSpark(
			ctx,
			"You write concise repair instructions for a coding agent. Output only the instruction to paste into Pi.",
			prompt,
			fallbackFixInstruction(failure),
			signal,
		);
	} catch {
		return fallbackFixInstruction(failure);
	}
}

async function completeSpark(
	ctx: ExtensionCommandContext,
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
	const response = await complete(
		model,
		{ systemPrompt, messages: [message] },
		{ apiKey: auth.apiKey, headers: auth.headers, signal },
	);
	if (response.stopReason === "aborted") return fallback;
	const text = response.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n")
		.trim();
	return text || fallback;
}

async function execOrFail(
	pi: ExtensionAPI,
	stepId: StepId,
	step: string,
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal,
	timeout = COMMAND_TIMEOUT_MS,
): Promise<ExecResult> {
	const result = await execCommand(pi, command, args, cwd, signal, timeout);
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
	pi: ExtensionAPI,
	command: string,
	args: string[],
	cwd: string,
	signal: AbortSignal,
	timeout = COMMAND_TIMEOUT_MS,
): Promise<ExecResult> {
	try {
		const result = await pi.exec(command, args, { cwd, timeout, signal });
		return { code: result.code, stdout: result.stdout, stderr: result.stderr, killed: result.killed };
	} catch (error) {
		if (signal.aborted) throw error;
		return {
			code: 1,
			stdout: "",
			stderr: error instanceof Error ? error.message : String(error),
		};
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
	for (const step of state.steps) {
		if (step.status === "running") step.status = "cancelled";
	}
}

function log(state: ProductionizeState, message: string): void {
	state.log.push(`${new Date().toLocaleTimeString()} ${message}`);
	if (state.log.length > 50) state.log.splice(0, state.log.length - 50);
}

export function unknownFailure(stepId: StepId, step: string, error: unknown): WorkflowFailure {
	return new WorkflowFailure(stepId, {
		step,
		message: error instanceof Error ? error.message : String(error),
	});
}

function recentConversationText(ctx: ExtensionCommandContext, limit: number): string {
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
		.map((part) => {
			if (part && typeof part === "object" && "type" in part && part.type === "text" && "text" in part) {
				return String(part.text);
			}
			return "";
		})
		.filter(Boolean)
		.join("\n");
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

