import { randomUUID } from "node:crypto";
import { join, relative, resolve } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { cleanupWorktree, createWorktree, describeDiscard, findGitCommonDir, inspectRepository, integrateWorktree, isWorkIntegrated } from "./git.ts";
import { clearIsolationState, isIsolationState, loadIsolationState, saveIsolationState, withIsolationLock } from "./state.ts";
import type { IsolationState, RepositoryInfo } from "./types.ts";

const STATUS_KEY = "isolate";
const POINTER_TYPE = "pi-isolate-job";
const MAX_AUTOMATIC_INTEGRATION_ATTEMPTS = 3;
const DRIVER_REGISTRY_KEY = Symbol.for("pi-isolate.active-driver-tokens.v1");
type SwitchOptions = NonNullable<Parameters<ExtensionCommandContext["switchSession"]>[1]>;
type ReplacementContext = Parameters<NonNullable<SwitchOptions["withSession"]>>[0];
interface SessionManagerModule {
	SessionManager: {
		forkFrom(sourceSessionFile: string, targetCwd: string): { getSessionFile(): string | undefined };
	};
}

interface IsolationDependencies {
	inspectRepository: typeof inspectRepository;
	findGitCommonDir: typeof findGitCommonDir;
	createWorktree: typeof createWorktree;
	integrateWorktree: typeof integrateWorktree;
	cleanupWorktree: typeof cleanupWorktree;
	describeDiscard: typeof describeDiscard;
	isWorkIntegrated: typeof isWorkIntegrated;
	loadIsolationState: typeof loadIsolationState;
	saveIsolationState: typeof saveIsolationState;
	clearIsolationState: typeof clearIsolationState;
	withIsolationLock: typeof withIsolationLock;
	forkSession(sourceSessionFile: string, targetCwd: string): Promise<string> | string;
	createId(): string;
	now(): Date;
	terminateProcess(): void;
}

interface IsolationPointer {
	version: 1;
	id: string;
	gitCommonDir: string;
	status: "active" | "cleanup_verified" | "cleared";
	state: IsolationState;
}

const defaultDependencies: IsolationDependencies = {
	inspectRepository,
	findGitCommonDir,
	createWorktree,
	integrateWorktree,
	cleanupWorktree,
	describeDiscard,
	isWorkIntegrated,
	loadIsolationState,
	saveIsolationState,
	clearIsolationState,
	withIsolationLock,
	async forkSession(sourceSessionFile, targetCwd) {
		const packageName = "@earendil-works/pi-coding-agent";
		const { SessionManager } = await import(packageName) as SessionManagerModule;
		const session = SessionManager.forkFrom(sourceSessionFile, targetCwd);
		const sessionFile = session.getSessionFile();
		if (!sessionFile) throw new Error("Pi did not persist the managed worktree session.");
		return sessionFile;
	},
	createId: () => randomUUID().replaceAll("-", "").slice(0, 8),
	now: () => new Date(),
	terminateProcess: () => process.exit(1),
};

export default function isolateExtension(pi: ExtensionAPI, dependencies: IsolationDependencies = defaultDependencies): void {
	const activeDriverTokens = processDriverRegistry();

	const sessionPointer = (ctx: ExtensionContext): IsolationPointer | undefined => {
		const entries = ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>;
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index];
			if (entry?.type !== "custom" || entry.customType !== POINTER_TYPE || !isIsolationPointer(entry.data)) continue;
			return entry.data;
		}
		return undefined;
	};

	const appendPointer = (state: IsolationState, status: IsolationPointer["status"]): void => {
		pi.appendEntry(POINTER_TYPE, {
			version: 1,
			id: state.id,
			gitCommonDir: state.gitCommonDir,
			status,
			state: structuredClone(state),
		} satisfies IsolationPointer);
	};

	const stateForContext = async (ctx: ExtensionContext): Promise<IsolationState | undefined> => {
		const pointer = sessionPointer(ctx);
		if (pointer?.status === "active") {
			const pointedState = await dependencies.loadIsolationState(pointer.gitCommonDir);
			if (!pointedState) return structuredClone(pointer.state);
			if (pointedState.id !== pointer.id) {
				throw new Error(`Session worktree pointer ${pointer.id} does not match repository job ${pointedState.id}.`);
			}
			return pointedState;
		}
		let commonDir: string;
		try {
			commonDir = await dependencies.findGitCommonDir(ctx.cwd);
		} catch {
			return undefined;
		}
		return dependencies.loadIsolationState(commonDir);
	};

	const stopRuntime = (ctx: ExtensionContext): void => {
		ctx.shutdown();
		if (ctx.mode !== "tui") dependencies.terminateProcess();
	};

	const loadExpectedState = async (commonDir: string, id: string): Promise<IsolationState> => {
		const latest = await dependencies.loadIsolationState(commonDir);
		if (!latest) throw new Error(`Worktree job ${id} no longer exists.`);
		if (latest.id !== id) throw new Error(`Worktree job ${id} was replaced by ${latest.id}; refusing a stale transition.`);
		return latest;
	};

	const cleanupAndClear = async (state: IsolationState, force: boolean): Promise<void> => {
		await dependencies.cleanupWorktree(state, { force }, undefined, {
			async onVerified(branchHead) {
				state.cleanupBranchHead = branchHead;
				await dependencies.saveIsolationState(state);
			},
		});
		appendPointer(state, "cleanup_verified");
		await dependencies.clearIsolationState(state.gitCommonDir);
		appendPointer(state, "cleared");
	};

	const unresolvedOriginalReason = async (ctx: ExtensionContext): Promise<string | undefined> => {
		try {
			const state = await stateForContext(ctx);
			if (!state || ctx.sessionManager.getSessionFile() === state.isolatedSessionFile) return undefined;
			return "The original session is locked by an unresolved managed worktree.";
		} catch {
			return "The original session is locked because managed worktree state is unreadable.";
		}
	};

	const finishAndReturn = async (ctx: ExtensionCommandContext, state: IsolationState): Promise<void> => {
		const current = await dependencies.withIsolationLock(state.gitCommonDir, async () => {
			const latest = await loadExpectedState(state.gitCommonDir, state.id);
			if (latest.exitMode === "discard" || latest.phase === "discarding" || latest.phase === "creating" || latest.phase === "done") {
				throw new Error(`Worktree job ${latest.id} cannot finish from phase ${latest.phase}.`);
			}
			if (!latest.integratedHead) {
				latest.phase = "integrating";
				latest.exitMode = "finish";
				latest.lastError = undefined;
				await dependencies.saveIsolationState(latest);
				try {
					latest.integratedHead = await dependencies.integrateWorktree(latest, undefined, {
						async onRebased(head, expectedParentHead) {
							latest.phase = "ff_pending";
							latest.rebasedHead = head;
							latest.expectedParentHead = expectedParentHead;
							await dependencies.saveIsolationState(latest);
						},
					});
					latest.phase = "integrated";
					await dependencies.saveIsolationState(latest);
				} catch (error) {
					latest.phase = failurePhase(latest, error);
					latest.lastError = errorText(error);
					await dependencies.saveIsolationState(latest);
					throw error;
				}
			}
			latest.phase = "cleanup_pending";
			latest.exitMode = "finish";
			latest.lastError = undefined;
			await dependencies.saveIsolationState(latest);
			return latest;
		});
		const result = await ctx.switchSession(current.sourceSessionFile, {
			withSession: async (parentCtx) => {
				const remaining = await dependencies.loadIsolationState(current.gitCommonDir);
				if (remaining) {
					parentCtx.ui.notify(`Worktree cleanup did not complete: ${remaining.lastError ?? "unknown cleanup failure"}`, "error");
					return;
				}
				parentCtx.ui.notify("Worktree changes were integrated and the worktree was removed.", "info");
			},
		});
		if (result.cancelled) {
			await dependencies.withIsolationLock(current.gitCommonDir, async () => {
				const latest = await loadExpectedState(current.gitCommonDir, current.id);
				if (latest.phase !== "cleanup_pending" || latest.exitMode !== "finish") {
					throw new Error("Worktree return cancellation raced with another transition.");
				}
				latest.phase = "integrated";
				latest.lastError = "Returning to the original session was cancelled.";
				await dependencies.saveIsolationState(latest);
			});
			throw new Error("Returning to the original session was cancelled.");
		}
	};

	const driveIsolatedTask = async (ctx: ReplacementContext, state: IsolationState): Promise<void> => {
		const driverToken = dependencies.createId();
		activeDriverTokens.add(driverToken);
		let driverPersisted = false;
		try {
			await dependencies.withIsolationLock(state.gitCommonDir, async () => {
				const latest = await loadExpectedState(state.gitCommonDir, state.id);
				if (latest.phase !== "active") throw new Error(`Worktree driver cannot start from phase ${latest.phase}.`);
				latest.driverToken = driverToken;
				await dependencies.saveIsolationState(latest);
				driverPersisted = true;
			});
			let prompt = kickoffPrompt(state);
			for (let attempt = 0; attempt < MAX_AUTOMATIC_INTEGRATION_ATTEMPTS; attempt++) {
				await ctx.sendUserMessage(prompt);
				const current = await dependencies.loadIsolationState(state.gitCommonDir);
				if (!current || current.id !== state.id || current.phase !== "finish_requested") return;
				try {
					await finishAndReturn(ctx, current);
					return;
				} catch (error) {
					prompt = recoveryPrompt(current, error);
				}
			}
			ctx.ui.notify("Automatic integration stopped after repeated failures. Resolve the issue here, then run /worktree-finish.", "warning");
		} finally {
			activeDriverTokens.delete(driverToken);
			if (driverPersisted) {
				await dependencies.withIsolationLock(state.gitCommonDir, async () => {
					const current = await dependencies.loadIsolationState(state.gitCommonDir);
					if (!current || current.id !== state.id || current.driverToken !== driverToken) return;
					current.driverToken = undefined;
					await dependencies.saveIsolationState(current);
				});
			}
		}
	};

	const startIsolation = async (task: string, ctx: ExtensionCommandContext): Promise<void> => {
		const trimmedTask = task.trim();
		if (!trimmedTask) {
			ctx.ui.notify("Usage: /worktree-start <task>", "warning");
			return;
		}
		await ctx.waitForIdle();
		const sourceSessionFile = ctx.sessionManager.getSessionFile();
		if (!sourceSessionFile) throw new Error("Managed worktrees require a persisted Pi session. Send at least one message first.");
		const repository = await dependencies.inspectRepository(ctx.cwd);
		let state = buildIsolationState({
			task: trimmedTask,
			sourceCwd: ctx.cwd,
			sourceSessionFile,
			repository,
			id: dependencies.createId(),
			now: dependencies.now(),
		});

		await dependencies.withIsolationLock(repository.commonDir, async () => {
			if (await dependencies.loadIsolationState(repository.commonDir)) {
				throw new Error("This repository already has an unresolved managed worktree job.");
			}
			appendPointer(state, "active");
			try {
				await dependencies.saveIsolationState(state);
				await dependencies.createWorktree(state);
				state.isolatedSessionFile = await dependencies.forkSession(sourceSessionFile, state.worktreeCwd);
				state.phase = "active";
				await dependencies.saveIsolationState(state);
				appendPointer(state, "active");
			} catch (error) {
				state.exitMode = "discard";
				state.lastError = errorText(error);
				try {
					await cleanupAndClear(state, true);
				} catch (cleanupError) {
					state.phase = "cleanup_pending";
					state.lastError = `${state.lastError}\nCleanup also failed: ${errorText(cleanupError)}`;
					try {
						await dependencies.saveIsolationState(state);
					} finally {
						stopRuntime(ctx);
					}
				}
				throw error;
			}
		});

		const isolatedSessionFile = required(state.isolatedSessionFile, "Managed worktree session file was not created.");
		const result = await ctx.switchSession(isolatedSessionFile, {
			withSession: async (replacementCtx) => {
				await driveIsolatedTask(replacementCtx, state);
			},
		});
		if (result.cancelled) {
			try {
				await dependencies.withIsolationLock(state.gitCommonDir, async () => {
					const latest = await loadExpectedState(state.gitCommonDir, state.id);
					latest.phase = "cleanup_pending";
					latest.exitMode = "discard";
					await dependencies.saveIsolationState(latest);
					await cleanupAndClear(latest, true);
				});
				ctx.ui.notify("Worktree session switch was cancelled; the temporary worktree was removed.", "warning");
			} catch (error) {
				try {
					await recordCleanupFailure(state.gitCommonDir, state.id, error);
				} finally {
					stopRuntime(ctx);
				}
				throw error;
			}
		}
	};

	const discardIsolation = async (ctx: ExtensionCommandContext): Promise<void> => {
		const state = await stateForContext(ctx);
		if (!state || ctx.sessionManager.getSessionFile() !== state.isolatedSessionFile) {
			ctx.ui.notify("No active managed worktree session is open here.", "warning");
			return;
		}
		if (state.integratedHead || state.phase === "integrated" || state.phase === "cleanup_pending" || await dependencies.isWorkIntegrated(state)) {
			ctx.ui.notify("This worktree's changes are already integrated and cannot be discarded; finish its cleanup instead.", "error");
			return;
		}
		const confirmed = await ctx.ui.confirm(
			"Discard worktree changes?",
			`Permanently delete the managed worktree at ${state.worktreePath}?\n\n${await dependencies.describeDiscard(state)}`,
		);
		if (!confirmed) return;
		const current = await dependencies.withIsolationLock(state.gitCommonDir, async () => {
			const latest = await loadExpectedState(state.gitCommonDir, state.id);
			if (latest.integratedHead || latest.phase === "integrated" || latest.phase === "cleanup_pending" || await dependencies.isWorkIntegrated(latest)) {
				throw new Error("This worktree's changes are already integrated and cannot be discarded; finish its cleanup instead.");
			}
			latest.phase = "discarding";
			latest.exitMode = "discard";
			latest.lastError = undefined;
			await dependencies.saveIsolationState(latest);
			return latest;
		});
		const result = await ctx.switchSession(current.sourceSessionFile, {
			withSession: async (parentCtx) => {
				const remaining = await dependencies.loadIsolationState(current.gitCommonDir);
				if (remaining) {
					parentCtx.ui.notify(`Worktree discard cleanup failed: ${remaining.lastError ?? "unknown cleanup failure"}`, "error");
					return;
				}
				parentCtx.ui.notify("Worktree changes were discarded and the worktree was removed.", "info");
			},
		});
		if (result.cancelled) {
			await dependencies.withIsolationLock(current.gitCommonDir, async () => {
				const latest = await loadExpectedState(current.gitCommonDir, current.id);
				if (latest.phase !== "discarding") throw new Error("Discard cancellation raced with another transition.");
				latest.phase = "active";
				latest.lastError = "Returning after discard was cancelled; no work was deleted.";
				await dependencies.saveIsolationState(latest);
			});
		}
	};

	const recordCleanupFailure = async (commonDir: string, id: string, error: unknown): Promise<void> => {
		await dependencies.withIsolationLock(commonDir, async () => {
			const latest = await loadExpectedState(commonDir, id);
			latest.phase = "cleanup_pending";
			latest.lastError = errorText(error);
			await dependencies.saveIsolationState(latest);
		});
	};

	pi.on("session_start", async (_event, ctx) => {
		let state: IsolationState | undefined;
		try {
			state = await stateForContext(ctx);
		} catch (error) {
			ctx.ui.notify(`Managed worktree state is unreadable: ${errorText(error)}`, "error");
			stopRuntime(ctx);
			return;
		}
		if (!state) return;
		const sessionFile = ctx.sessionManager.getSessionFile();
		if (sessionFile === state.sourceSessionFile && (state.phase === "creating" || state.phase === "cleanup_pending" || state.phase === "discarding")) {
			try {
				await dependencies.withIsolationLock(state.gitCommonDir, async () => {
					let latest = await dependencies.loadIsolationState(state.gitCommonDir);
					if (!latest) {
						const pointer = sessionPointer(ctx);
						if (state.phase !== "creating" || pointer?.status !== "active" || pointer.id !== state.id) {
							throw new Error(`Worktree job ${state.id} no longer exists.`);
						}
						latest = structuredClone(pointer.state);
						await dependencies.saveIsolationState(latest);
					}
					if (latest.id !== state.id) {
						throw new Error(`Worktree job ${state.id} was replaced by ${latest.id}; refusing stale cleanup.`);
					}
					if (latest.phase !== "creating" && latest.phase !== "cleanup_pending" && latest.phase !== "discarding") {
						throw new Error(`Worktree job ${latest.id} is not ready for parent cleanup (${latest.phase}).`);
					}
					await cleanupAndClear(latest, latest.phase === "creating" || latest.exitMode === "discard");
				});
				ctx.ui.setStatus(STATUS_KEY, undefined);
				return;
			} catch (error) {
				try {
					await recordCleanupFailure(state.gitCommonDir, state.id, error);
				} catch {
					// A replacement job must never be overwritten by stale cleanup recovery.
				}
				ctx.ui.notify(`Worktree cleanup failed before return: ${errorText(error)}`, "error");
				stopRuntime(ctx);
				return;
			}
		}
		if (sessionFile !== state.isolatedSessionFile) {
			ctx.ui.notify(
				`Worktree job ${state.id} is unresolved. Resume ${state.isolatedSessionFile ?? state.worktreePath} to finish or discard it.`,
				"error",
			);
			stopRuntime(ctx);
			return;
		}
		const pointer = sessionPointer(ctx);
		if (pointer?.status !== "active" || pointer.id !== state.id || pointer.state.isolatedSessionFile !== state.isolatedSessionFile) {
			appendPointer(state, "active");
		}
		ctx.ui.setStatus(STATUS_KEY, `worktree: ${state.worktreeBranch}`);
	});

	pi.on("session_before_switch", async (event, ctx) => {
		let state: IsolationState | undefined;
		try {
			state = await stateForContext(ctx);
		} catch (error) {
			ctx.ui.notify(`Cannot switch while managed worktree state is unreadable: ${errorText(error)}`, "error");
			return { cancel: true };
		}
		if (!state) return;
		const currentSession = ctx.sessionManager.getSessionFile();
		if (currentSession === state.sourceSessionFile && event.targetSessionFile === state.isolatedSessionFile) return;
		const authorizedReturn = currentSession === state.isolatedSessionFile
			&& event.targetSessionFile === state.sourceSessionFile
			&& (state.phase === "cleanup_pending" || state.phase === "discarding");
		if (authorizedReturn) return;
		ctx.ui.notify("Finish or discard the active managed worktree before switching sessions.", "warning");
		return { cancel: true };
	});

	pi.on("session_before_fork", async (_event, ctx) => {
		try {
			if (!(await stateForContext(ctx))) return;
		} catch (error) {
			ctx.ui.notify(`Cannot fork while managed worktree state is unreadable: ${errorText(error)}`, "error");
			return { cancel: true };
		}
		ctx.ui.notify("Finish or discard the active managed worktree before forking the session.", "warning");
		return { cancel: true };
	});

	pi.on("input", async (_event, ctx) => {
		const reason = await unresolvedOriginalReason(ctx);
		if (!reason) return;
		ctx.ui.notify(reason, "error");
		stopRuntime(ctx);
		return { action: "handled" as const };
	});

	pi.on("tool_call", async (_event, ctx) => {
		const reason = await unresolvedOriginalReason(ctx);
		if (!reason) return;
		return { block: true, reason };
	});

	pi.on("user_bash", async (_event, ctx) => {
		const reason = await unresolvedOriginalReason(ctx);
		if (!reason) return;
		return { result: { output: `${reason}\n`, exitCode: 1, cancelled: false, truncated: false } };
	});

	pi.on("before_agent_start", async (event, ctx) => {
		const state = await stateForContext(ctx);
		if (!state || ctx.sessionManager.getSessionFile() !== state.isolatedSessionFile) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\nManaged worktree job ${state.id}: Work only in the current worktree. Remain here until integration succeeds. After implementing and validating the task, call worktree_finish as your final action. If integration reports a conflict or failure, resolve it in this worktree and call worktree_finish again. Do not switch sessions or remove worktrees manually.`,
		};
	});

	pi.registerCommand("worktree-start", {
		description: "Create a managed worktree and start a task there",
		handler: async (args, ctx) => {
			if (!ctx.hasUI) throw new Error("/worktree-start requires interactive Pi.");
			try {
				await startIsolation(args, ctx);
			} catch (error) {
				ctx.ui.notify(errorText(error), "error");
			}
		},
	});

	pi.registerCommand("worktree-finish", {
		description: "Integrate the active managed worktree, clean it up, and return",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) throw new Error("/worktree-finish requires interactive Pi.");
			try {
				await ctx.waitForIdle();
				const state = await stateForContext(ctx);
				if (!state || ctx.sessionManager.getSessionFile() !== state.isolatedSessionFile) {
					ctx.ui.notify("No active managed worktree session is open here.", "warning");
					return;
				}
				await finishAndReturn(ctx, state);
			} catch (error) {
				ctx.ui.notify(errorText(error), "error");
			}
		},
	});

	pi.registerCommand("worktree-discard", {
		description: "Discard the active managed worktree and return",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) throw new Error("/worktree-discard requires interactive Pi.");
			try {
				await discardIsolation(ctx);
			} catch (error) {
				ctx.ui.notify(errorText(error), "error");
			}
		},
	});

	pi.registerCommand("worktree-status", {
		description: "Show the active managed worktree job",
		handler: async (_args, ctx) => {
			const state = await stateForContext(ctx);
			ctx.ui.notify(state ? `Worktree ${state.id}: ${state.phase} (${state.worktreePath})` : "No active managed worktree.", "info");
		},
	});

	pi.registerTool({
		name: "worktree_start",
		label: "Start Worktree",
		description: "Start the requested task in a managed Git worktree. Use when the user asks to start or move the current work onto a worktree.",
		promptSnippet: "Start a task in a managed Git worktree",
		promptGuidelines: ["Call worktree_start when the user asks to start the current task on a worktree; infer a concise task from the request and conversation context."],
		parameters: {
			type: "object",
			properties: { task: { type: "string", description: "The concrete task to perform in the worktree" } },
			required: ["task"],
			additionalProperties: false,
		},
		async execute(_toolCallId, params: { task: string }) {
			const task = params.task.trim();
			if (!task) {
				return {
					content: [{ type: "text" as const, text: "A concrete task is required to start a managed worktree." }],
					details: { status: "task_required" },
				};
			}
			pi.sendUserMessage(`/worktree-start ${task}`, { deliverAs: "followUp" });
			return {
				content: [{ type: "text" as const, text: "Queued the task to start in a managed worktree after this turn settles." }],
				details: { status: "start_queued" },
			};
		},
	});

	pi.registerTool({
		name: "worktree_finish",
		label: "Finish Worktree",
		description: "Signal that the current managed-worktree task is implemented and validated. Use this as the final action; Pi will integrate and return after the turn settles.",
		promptSnippet: "Finish the active managed-worktree task after implementation and validation",
		promptGuidelines: ["Use worktree_finish as the final action only after the managed-worktree task is implemented and relevant validation passes."],
		parameters: { type: "object", properties: {}, additionalProperties: false },
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const state = await stateForContext(ctx);
			if (!state || ctx.sessionManager.getSessionFile() !== state.isolatedSessionFile) {
				return {
					content: [{ type: "text" as const, text: "No active managed worktree task is open in this session." }],
					details: { status: "not_active" },
				};
			}
			const transition = await dependencies.withIsolationLock(state.gitCommonDir, async () => {
				const latest = await loadExpectedState(state.gitCommonDir, state.id);
				if (ctx.sessionManager.getSessionFile() !== latest.isolatedSessionFile) {
					throw new Error("The worktree session changed before finish could be requested.");
				}
				if (!["active", "finish_requested", "conflicted", "ff_pending", "integrating"].includes(latest.phase)) {
					throw new Error(`Worktree job ${latest.id} cannot request finish from phase ${latest.phase}.`);
				}
				latest.phase = "finish_requested";
				latest.lastError = undefined;
				await dependencies.saveIsolationState(latest);
				return { latest, hasAutomaticDriver: Boolean(latest.driverToken && activeDriverTokens.has(latest.driverToken)) };
			});
			const { latest, hasAutomaticDriver } = transition;
			if (!hasAutomaticDriver) pi.sendUserMessage("/worktree-finish", { deliverAs: "followUp" });
			return {
				content: [{
					type: "text" as const,
					text: hasAutomaticDriver
						? "Worktree task marked complete. Pi will begin finishing after this turn settles."
						: "Worktree task marked complete. Finishing is queued for after this turn settles.",
				}],
				details: { status: "finish_requested", jobId: latest.id, automatic: hasAutomaticDriver },
				terminate: true,
			};
		},
	});
}

export function buildIsolationState(options: {
	task: string;
	sourceCwd: string;
	sourceSessionFile: string;
	repository: RepositoryInfo;
	id: string;
	now: Date;
}): IsolationState {
	const { task, sourceCwd, sourceSessionFile, repository, id, now } = options;
	const slug = taskSlug(task);
	const worktreePath = join(repository.root, ".worktrees", `${slug}-${id}`);
	const relativeCwd = relative(repository.root, resolve(sourceCwd));
	return {
		version: 1,
		id,
		phase: "creating",
		task,
		createdAt: now.toISOString(),
		repositoryRoot: repository.root,
		gitCommonDir: repository.commonDir,
		baseBranch: repository.branch,
		baseHead: repository.head,
		sourceCwd: resolve(sourceCwd),
		sourceSessionFile,
		worktreePath,
		worktreeCwd: relativeCwd ? join(worktreePath, relativeCwd) : worktreePath,
		worktreeBranch: `pi-worktree/${slug}-${id}`,
	};
}

function kickoffPrompt(state: IsolationState): string {
	return [
		`Managed worktree job ${state.id}.`,
		`Work on this task in the current managed worktree: ${state.task}`,
		"Implement the task completely and run the relevant validation. Stay in this worktree.",
		"When the work is ready to integrate, call worktree_finish as your final action. Do not run /worktree-finish yourself or remove the worktree.",
	].join("\n\n");
}

function recoveryPrompt(state: IsolationState, error: unknown): string {
	return [
		`Managed worktree job ${state.id} could not integrate:`,
		errorText(error),
		"Resolve the problem in this managed worktree, rerun the relevant validation, then call worktree_finish again. Do not return to the original session manually.",
	].join("\n\n");
}

function taskSlug(task: string): string {
	return task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 40)
		.replace(/-+$/g, "") || "task";
}

function isConflictError(error: unknown): boolean {
	return /conflict|rebase.*progress/i.test(errorText(error));
}

function failurePhase(state: IsolationState, error: unknown): IsolationState["phase"] {
	if (isConflictError(error)) return "conflicted";
	if (state.rebasedHead) return "ff_pending";
	return "active";
}

function errorText(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function required<T>(value: T | undefined, message: string): T {
	if (value === undefined) throw new Error(message);
	return value;
}

function isIsolationPointer(value: unknown): value is IsolationPointer {
	if (!value || typeof value !== "object") return false;
	const pointer = value as Partial<IsolationPointer>;
	return pointer.version === 1
		&& typeof pointer.id === "string"
		&& pointer.id.length > 0
		&& typeof pointer.gitCommonDir === "string"
		&& pointer.gitCommonDir.length > 0
		&& isIsolationState(pointer.state)
		&& pointer.state.id === pointer.id
		&& resolve(pointer.state.gitCommonDir) === resolve(pointer.gitCommonDir)
		&& (pointer.status === "active" || pointer.status === "cleanup_verified" || pointer.status === "cleared");
}

function processDriverRegistry(): Set<string> {
	const shared = globalThis as typeof globalThis & { [DRIVER_REGISTRY_KEY]?: Set<string> };
	shared[DRIVER_REGISTRY_KEY] ??= new Set<string>();
	return shared[DRIVER_REGISTRY_KEY];
}
