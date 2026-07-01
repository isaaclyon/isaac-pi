import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { reconstructAutoState, parseProductionizeArgs, prepareStateForModelRun } from "./auto.ts";
import type { StepId } from "./core.ts";
import { buildProductionizeCompletionMessage, buildProductionizeFailurePrompt } from "./handoff.ts";
import { ProductionizePanel } from "./panel.ts";
import type { ProductionizeState } from "./types.ts";
import { createInitialState, markRunningCancelled, runWorkflow, unknownFailure, type ProductionizeRunOptions } from "./workflow.ts";

const STATUS_KEY = "productionize";
const PRODUCTIONIZE_RUN_DESCRIPTION =
	"Run the productionize workflow in the background. " +
	"This async tool returns immediately after starting. " +
	"Do not poll for status or reread logs in a loop; completion or failure will be delivered automatically as a steer message. " +
	"If a run fails, fix it in-band in this same session before calling productionize_run again. " +
	"Do not use side sessions, imported patches, or autonomous retry loops.";

interface ActiveRun {
	sessionFile: string;
	controller: AbortController;
	state: ProductionizeState;
}

interface ProductionizeDependencies {
	reconstructAutoState: typeof reconstructAutoState;
	prepareStateForModelRun: typeof prepareStateForModelRun;
	createInitialState: typeof createInitialState;
	runWorkflow: typeof runWorkflow;
	buildProductionizeFailurePrompt: typeof buildProductionizeFailurePrompt;
	buildProductionizeCompletionMessage: typeof buildProductionizeCompletionMessage;
}

const defaultDeps: ProductionizeDependencies = {
	reconstructAutoState,
	prepareStateForModelRun,
	createInitialState,
	runWorkflow,
	buildProductionizeFailurePrompt,
	buildProductionizeCompletionMessage,
};

function getSessionFile(ctx: ExtensionContext): string {
	return ctx.sessionManager.getSessionFile() ?? `${ctx.cwd}:productionize`;
}

function updateStatus(ctx: ExtensionContext, value?: string): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, value);
}

function isResumableState(state?: ProductionizeState): state is ProductionizeState {
	return Boolean(state?.auto.enabled && (state.outcome === "failed" || state.outcome === "running"));
}

export default function productionizeExtension(pi: ExtensionAPI, deps: ProductionizeDependencies = defaultDeps): void {
	let activeRun: ActiveRun | undefined;

	const clearActiveRun = (sessionFile: string): void => {
		if (activeRun?.sessionFile === sessionFile) activeRun = undefined;
	};

	const createController = (ctx: ExtensionContext, state: ProductionizeState): AbortController | undefined => {
		const sessionFile = getSessionFile(ctx);
		if (activeRun) return undefined;
		const controller = new AbortController();
		activeRun = { sessionFile, controller, state };
		return controller;
	};

	const launchPanel = async (
		ctx: ExtensionContext,
		state: ProductionizeState,
		options: ProductionizeRunOptions,
	): Promise<{ action: "close" | "handoff" } | undefined> => {
		if (!ctx.hasUI) return;
		const sessionFile = getSessionFile(ctx);
		const controller = createController(ctx, state);
		if (!controller) return;

		let requestRender: (() => void) | undefined;
		let result: { action: "close" | "handoff" } | undefined;

		try {
			result = await ctx.ui.custom<{ action: "close" | "handoff" }>((tui, theme, _keybindings, done) => {
				const panel = new ProductionizePanel(state, theme, done, () => controller.abort());
				requestRender = () => {
					panel.invalidate();
					tui.requestRender();
				};

				void deps.runWorkflow(pi, ctx, state, controller.signal, () => requestRender?.(), options).catch((error) => {
					if (controller.signal.aborted || state.cancelRequested) {
						state.outcome = "cancelled";
						state.status = "Productionize cancelled.";
						markRunningCancelled(state);
					} else {
						const failure = unknownFailure(state.auto.activeCheckpoint ?? "branch", "Workflow", error);
						state.outcome = "failed";
						state.failure = failure.failure;
					}
					requestRender?.();
				});

				return panel;
			});
		} finally {
			clearActiveRun(sessionFile);
		}

		return result;
	};

	const startToolRun = async (
		ctx: ExtensionContext,
		state: ProductionizeState,
		options: ProductionizeRunOptions,
	): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> => {
		const sessionFile = getSessionFile(ctx);
		const controller = createController(ctx, state);
		if (!controller) {
			return {
				content: [{ type: "text", text: "Productionize is already running in this session." }],
				details: { status: "already_running" },
			};
		}

		updateStatus(ctx, state.status);
		void deps
			.runWorkflow(pi, ctx, state, controller.signal, () => updateStatus(ctx, state.status), options)
			.catch((error) => {
				if (controller.signal.aborted || state.cancelRequested) {
					state.outcome = "cancelled";
					state.status = "Productionize cancelled.";
					markRunningCancelled(state);
					return;
				}
				const failure = unknownFailure(state.auto.activeCheckpoint ?? state.auto.resumeFromCheckpoint ?? "branch", "Workflow", error);
				state.outcome = "failed";
				state.status = `Productionize failed during ${failure.failure.step}.`;
				state.failure = failure.failure;
			})
			.finally(() => {
				updateStatus(ctx, undefined);
				clearActiveRun(sessionFile);
				pi.sendMessage(
					{
						customType: "productionize_run_result",
						content: deps.buildProductionizeCompletionMessage(state),
						display: true,
						details: {
							status: state.outcome,
							outcome: state.outcome,
							productionizeStatus: state.status,
						},
					},
					{ triggerTurn: true, deliverAs: "steer" },
				);
			});

		return {
			content: [{ type: "text", text: "Productionize started in the background. Do not poll; wait for the steer message with completion or failure." }],
			details: { status: "started" },
		};
	};

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		const restored = deps.reconstructAutoState(ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>);
		const state = restored.state;
		if (!state || !state.auto.enabled) return;
		if (state.outcome !== "running") return;
		void launchPanel(ctx, state, { auto: true });
	});

	pi.on("session_shutdown", () => {
		activeRun?.controller.abort();
		activeRun = undefined;
	});

	pi.registerCommand("productionize", {
		description: "Branch, commit, push, open a PR, watch CI, squash-merge, or run one named stage with a progress TUI",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/productionize requires interactive Pi", "error");
				return;
			}

			const parsed = parseProductionizeArgs(args);
			if (parsed.usageError) {
				ctx.ui.notify(parsed.usageError, "warning");
				return;
			}

			await ctx.waitForIdle();
			const scoped = parsed.targetStep ? { startFrom: "branch" as const, stopAfter: parsed.targetStep } : {};
			const state = deps.createInitialState({ auto: parsed.auto, ...scoped });
			if (parsed.auto) state.status = "Starting productionize auto mode...";
			else if (parsed.targetStep) state.status = `Starting productionize through ${parsed.targetStep}...`;
			const result = await launchPanel(ctx, state, { auto: parsed.auto, ...scoped });
			if (result?.action === "handoff" && state.failure) {
				pi.sendUserMessage(deps.buildProductionizeFailurePrompt(state));
			}
		},
	});

	pi.registerTool({
		name: "productionize_run",
		label: "Productionize Run",
		description: PRODUCTIONIZE_RUN_DESCRIPTION,
		promptSnippet: PRODUCTIONIZE_RUN_DESCRIPTION,
		parameters: {
			type: "object",
			properties: {
				resume: {
					type: "boolean",
					description: "Resume the latest failed or running persisted productionize state when available. Defaults to true.",
				},
				targetStep: {
					type: "string",
					enum: ["branch", "commit", "push", "pr", "ci", "merge", "return"],
					description: "Optional stage to run through from branch. Omit for the full workflow or persisted resume.",
				},
			},
			additionalProperties: false,
		},
		renderResult(result) {
			const details = result.details as Record<string, unknown> | undefined;
			if (details?.status === "started") return "productionize_run — started";
			if (details?.status === "already_running") return "productionize_run — already running";
			return typeof result.content[0]?.text === "string" ? result.content[0].text : "";
		},
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			await ctx.waitForIdle?.();
			const restored = deps.reconstructAutoState(ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>).state as ProductionizeState | undefined;
			const shouldResume = params.resume !== false;
			const targetStep = isStepId(params.targetStep) ? params.targetStep : undefined;
			const runOptions: ProductionizeRunOptions = targetStep
				? { auto: true, startFrom: "branch", stopAfter: targetStep }
				: { auto: true };
			const state = targetStep
				? deps.createInitialState(runOptions)
				: shouldResume && isResumableState(restored)
				? deps.prepareStateForModelRun(restored)
				: deps.createInitialState({ auto: true });
			if (!shouldResume && !state.status) state.status = "Starting productionize auto mode...";
			return startToolRun(ctx, state, runOptions);
		},
	});
}

function isStepId(value: unknown): value is StepId {
	return value === "branch" || value === "commit" || value === "push" || value === "pr" || value === "ci" || value === "merge" || value === "return";
}
