import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type {
	RalphDeterministicSuccessConfig,
	RalphQuantitativeCheck,
	RalphRunConfig,
	RalphSuccessConfig,
} from "./types.js";
import type { RalphStore } from "./store.js";

export type RalphLoopExecutionResult = {
	triggerReason: string;
	summary: string;
	artifacts: Record<string, unknown>;
	nextPrompt: string;
	state: "completed" | "failed" | "stopped";
};

export type RalphExecuteLoop = (input: {
	runId: string;
	loopNumber: number;
	config: RalphRunConfig;
	previousCheckpoint: string | null;
	signal?: AbortSignal;
}) => Promise<RalphLoopExecutionResult>;

type CommandResult = {
	command: string;
	exitCode: number;
	stdout: string;
	stderr: string;
};

type SuccessEvalState = {
	mustFailObserved: boolean;
};

type SuccessEvaluation = {
	status: "succeeded" | "continue" | "failed";
	reason: string;
	details: Record<string, unknown>;
	nextState: SuccessEvalState;
};

async function runCommand(command: string, cwd: string): Promise<CommandResult> {
	return new Promise((resolveValue) => {
		const shell = process.env.SHELL || "/bin/sh";
		const proc = spawn(shell, ["-lc", command], {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: process.env,
		});

		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => {
			stdout += String(chunk);
		});
		proc.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		proc.on("error", (error) => {
			stderr += String(error);
			resolveValue({ command, exitCode: 1, stdout, stderr });
		});
		proc.on("close", (code) => {
			resolveValue({
				command,
				exitCode: typeof code === "number" ? code : 1,
				stdout,
				stderr,
			});
		});
	});
}

function matchesRegex(text: string, pattern: string | undefined): boolean {
	if (!pattern) return true;
	try {
		return new RegExp(pattern, "m").test(text);
	} catch {
		return false;
	}
}

function checkQuantitativeResult(result: CommandResult, check: RalphQuantitativeCheck): { passed: boolean; reason?: string } {
	const expectedExitCode = check.expectedExitCode ?? 0;
	if (result.exitCode !== expectedExitCode) {
		return { passed: false, reason: `exit code ${result.exitCode} != ${expectedExitCode}` };
	}
	if (!matchesRegex(result.stdout, check.stdoutIncludes)) {
		return { passed: false, reason: "stdoutIncludes regex did not match" };
	}
	if (check.stdoutExcludes && matchesRegex(result.stdout, check.stdoutExcludes)) {
		return { passed: false, reason: "stdoutExcludes regex matched unexpectedly" };
	}
	if (!matchesRegex(result.stderr, check.stderrIncludes)) {
		return { passed: false, reason: "stderrIncludes regex did not match" };
	}
	if (check.stderrExcludes && matchesRegex(result.stderr, check.stderrExcludes)) {
		return { passed: false, reason: "stderrExcludes regex matched unexpectedly" };
	}
	return { passed: true };
}

async function evaluateQuantitative(
	config: { checks: RalphQuantitativeCheck[] },
	cwd: string,
	evalState: SuccessEvalState,
): Promise<SuccessEvaluation> {
	const results: Array<Record<string, unknown>> = [];
	for (const check of config.checks) {
		const cmdResult = await runCommand(check.command, cwd);
		const checkResult = checkQuantitativeResult(cmdResult, check);
		results.push({
			command: check.command,
			exitCode: cmdResult.exitCode,
			stdout: cmdResult.stdout,
			stderr: cmdResult.stderr,
			passed: checkResult.passed,
			reason: checkResult.reason,
		});
		if (!checkResult.passed) {
			return {
				status: "continue",
				reason: "quantitative_check_failed",
				details: { checks: results },
				nextState: evalState,
			};
		}
	}

	return {
		status: "succeeded",
		reason: "quantitative_checks_passed",
		details: { checks: results },
		nextState: evalState,
	};
}

async function evaluateDeterministic(
	config: RalphDeterministicSuccessConfig,
	cwd: string,
	evalState: SuccessEvalState,
): Promise<SuccessEvaluation> {
	if (!evalState.mustFailObserved) {
		const failResults: CommandResult[] = [];
		for (const command of config.mustFail) {
			const result = await runCommand(command, cwd);
			failResults.push(result);
			if (result.exitCode === 0) {
				return {
					status: "failed",
					reason: "deterministic_must_fail_unexpected_pass",
					details: { mustFail: failResults },
					nextState: evalState,
				};
			}
		}

		return {
			status: "continue",
			reason: "deterministic_must_fail_observed",
			details: { mustFail: failResults },
			nextState: { mustFailObserved: true },
		};
	}

	const passResults: CommandResult[] = [];
	for (const command of config.mustPass) {
		const result = await runCommand(command, cwd);
		passResults.push(result);
		if (result.exitCode !== 0) {
			return {
				status: "continue",
				reason: "deterministic_must_pass_not_ready",
				details: { mustPass: passResults },
				nextState: evalState,
			};
		}
	}

	return {
		status: "succeeded",
		reason: "deterministic_passed",
		details: { mustPass: passResults },
		nextState: evalState,
	};
}

async function evaluateSuccess(
	success: RalphSuccessConfig,
	cwd: string,
	evalState: SuccessEvalState,
): Promise<SuccessEvaluation> {
	if (success.mode === "quantitative") {
		return evaluateQuantitative(success, cwd, evalState);
	}

	if (success.mode === "deterministic-tdd") {
		return evaluateDeterministic(success, cwd, evalState);
	}

	if (success.mode === "qualitative") {
		if (success.allowStandalone) {
			return {
				status: "succeeded",
				reason: "qualitative_allow_standalone",
				details: { notes: success.notes ?? "" },
				nextState: evalState,
			};
		}
		return {
			status: "continue",
			reason: "qualitative_needs_nonstandalone_signal",
			details: { notes: success.notes ?? "" },
			nextState: evalState,
		};
	}

	const deterministic = success.deterministic
		? await evaluateDeterministic({ mode: "deterministic-tdd", ...success.deterministic }, cwd, evalState)
		: {
				status: "continue" as const,
				reason: "hybrid_no_deterministic",
				details: {},
				nextState: evalState,
		  };

	if (deterministic.status === "failed") {
		return deterministic;
	}

	const quantitative = success.quantitative
		? await evaluateQuantitative({ checks: success.quantitative.checks }, cwd, deterministic.nextState)
		: {
				status: "continue" as const,
				reason: "hybrid_no_quantitative",
				details: {},
				nextState: deterministic.nextState,
		  };

	if (quantitative.status === "failed") {
		return quantitative;
	}

	const qualitativeStandalone = success.qualitative?.allowStandalone === true;
	if (
		(success.deterministic ? deterministic.status === "succeeded" : true)
		&& (success.quantitative ? quantitative.status === "succeeded" : true)
		&& (success.qualitative ? qualitativeStandalone : true)
	) {
		return {
			status: "succeeded",
			reason: "hybrid_passed",
			details: {
				deterministic: deterministic.details,
				quantitative: quantitative.details,
				qualitative: success.qualitative ?? null,
			},
			nextState: quantitative.nextState,
		};
	}

	return {
		status: "continue",
		reason: "hybrid_not_ready",
		details: {
			deterministic: deterministic.details,
			quantitative: quantitative.details,
			qualitative: success.qualitative ?? null,
		},
		nextState: quantitative.nextState,
	};
}

export async function runRalphSupervisor(input: {
	store: RalphStore;
	runId: string;
	config: RalphRunConfig;
	executeLoop: RalphExecuteLoop;
	signal?: AbortSignal;
}): Promise<void> {
	let previousCheckpoint: string | null = null;
	let evalState: SuccessEvalState = { mustFailObserved: false };

	for (let loopNumber = 1; loopNumber <= input.config.maxLoops; loopNumber += 1) {
		if (input.signal?.aborted) {
			input.store.updateRunState(input.runId, "stopped", Date.now());
			input.store.appendEvent({
				runId: input.runId,
				eventType: "run_stopped",
				payloadJson: JSON.stringify({ reason: "abort_signal" }),
				createdAt: Date.now(),
			});
			return;
		}

		const startedAt = Date.now();
		const loop = input.store.startLoop({
			runId: input.runId,
			loopNumber,
			startedAt,
		});
		input.store.appendEvent({
			runId: input.runId,
			loopId: loop.loopId,
			eventType: "loop_started",
			payloadJson: JSON.stringify({ loopNumber }),
			createdAt: startedAt,
		});

		const result = await input.executeLoop({
			runId: input.runId,
			loopNumber,
			config: input.config,
			previousCheckpoint,
			signal: input.signal,
		});

		const checkpoint = {
			checkpointId: randomUUID(),
			runId: input.runId,
			loopNumber,
			triggerReason: result.triggerReason,
			summary: result.summary,
			artifacts: result.artifacts,
			nextPrompt: result.nextPrompt,
			createdAt: Date.now(),
		};

		const checkpointJson = JSON.stringify(checkpoint);
		input.store.completeLoop({
			runId: input.runId,
			loopNumber,
			state: result.state,
			triggerReason: result.triggerReason,
			summary: result.summary,
			checkpointJson,
			endedAt: Date.now(),
		});

		input.store.saveCheckpoint({
			runId: input.runId,
			loopNumber,
			triggerReason: result.triggerReason,
			summary: result.summary,
			artifactsJson: JSON.stringify(result.artifacts),
			nextPrompt: result.nextPrompt,
			createdAt: Date.now(),
		});

		input.store.appendEvent({
			runId: input.runId,
			loopId: loop.loopId,
			eventType: "loop_completed",
			payloadJson: JSON.stringify({
				loopNumber,
				triggerReason: result.triggerReason,
				state: result.state,
			}),
			createdAt: Date.now(),
		});

		previousCheckpoint = checkpointJson;

		if (result.state === "failed") {
			input.store.updateRunState(input.runId, "failed", Date.now());
			return;
		}
		if (result.state === "stopped") {
			input.store.updateRunState(input.runId, "stopped", Date.now());
			return;
		}

		const success = await evaluateSuccess(input.config.success, input.config.runner.cwd, evalState);
		evalState = success.nextState;

		input.store.appendEvent({
			runId: input.runId,
			loopId: loop.loopId,
			eventType: "success_evaluated",
			payloadJson: JSON.stringify({
				loopNumber,
				status: success.status,
				reason: success.reason,
				details: success.details,
			}),
			createdAt: Date.now(),
		});

		if (success.status === "failed") {
			input.store.updateRunState(input.runId, "failed", Date.now());
			return;
		}

		if (success.status === "succeeded") {
			input.store.updateRunState(input.runId, "succeeded", Date.now());
			return;
		}
	}

	input.store.updateRunState(input.runId, "max_loops_reached", Date.now());
}
