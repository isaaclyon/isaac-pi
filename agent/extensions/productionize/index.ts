import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { reconstructAutoState, parseProductionizeArgs } from "./auto.ts";
import { fallbackFixInstruction } from "./core.ts";
import { ProductionizePanel } from "./panel.ts";
import type { PanelResult, ProductionizeState } from "./types.ts";
import { createInitialState, markRunningCancelled, runWorkflow, unknownFailure, type ProductionizeRunOptions } from "./workflow.ts";

export default function productionizeExtension(pi: ExtensionAPI): void {
	let activeRun: { sessionFile: string; controller: AbortController } | undefined;

	const launchPanel = async (ctx: ExtensionContext, state: ProductionizeState, options: ProductionizeRunOptions): Promise<void> => {
		if (!ctx.hasUI) return;
		const sessionFile = ctx.sessionManager.getSessionFile() ?? `${ctx.cwd}:productionize`;
		if (activeRun?.sessionFile === sessionFile) return;

		const controller = new AbortController();
		activeRun = { sessionFile, controller };
		let requestRender: (() => void) | undefined;

		try {
			const result = await ctx.ui.custom<PanelResult>((tui, theme, _keybindings, done) => {
				const panel = new ProductionizePanel(state, theme, done, () => controller.abort());
				requestRender = () => {
					panel.invalidate();
					tui.requestRender();
				};

				void runWorkflow(pi, ctx, state, controller.signal, () => requestRender?.(), options).catch((error) => {
					if (controller.signal.aborted || state.cancelRequested) {
						state.outcome = "cancelled";
						state.status = "Productionize cancelled.";
						markRunningCancelled(state);
					} else {
						const failure = unknownFailure(state.auto.activeCheckpoint ?? "branch", "Workflow", error);
						state.outcome = "failed";
						state.failure = failure.failure;
						if (!state.auto.enabled) state.fixInstruction = fallbackFixInstruction(failure.failure);
					}
					requestRender?.();
				});

				return panel;
			});

			if (!state.auto.enabled && result?.action === "fix" && "setEditorText" in ctx.ui) {
				ctx.ui.setEditorText(result.instruction);
				ctx.ui.notify("Productionize fix instruction pasted. Submit when ready.", "info");
			}
		} finally {
			if (activeRun?.sessionFile === sessionFile) activeRun = undefined;
		}
	};

	pi.on("session_start", (_event, ctx) => {
		if (!ctx.hasUI || ctx.mode !== "tui") return;
		const restored = reconstructAutoState(ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>);
		const state = restored.state;
		if (!state || !state.auto.enabled) return;
		if (state.outcome !== "running" && !state.auto.currentRepair) return;
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
			const state = createInitialState({ auto: parsed.auto, ...scoped });
			if (parsed.auto) state.status = "Starting productionize auto mode...";
			else if (parsed.targetStep) state.status = `Starting productionize through ${parsed.targetStep}...`;
			await launchPanel(ctx, state, { auto: parsed.auto, ...scoped });
		},
	});
}
