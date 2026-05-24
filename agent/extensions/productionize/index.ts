import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { fallbackFixInstruction } from "./core.ts";
import { ProductionizePanel } from "./panel.ts";
import type { PanelResult } from "./types.ts";
import { createInitialState, markRunningCancelled, runWorkflow, unknownFailure } from "./workflow.ts";

export default function productionizeExtension(pi: ExtensionAPI): void {
	pi.registerCommand("productionize", {
		description: "Branch, commit, push, open a PR, watch CI, and squash-merge with a progress TUI",
		handler: async (_args: string, ctx: ExtensionCommandContext) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("/productionize requires interactive Pi", "error");
				return;
			}

			await ctx.waitForIdle();

			const state = createInitialState();
			const controller = new AbortController();
			let requestRender: (() => void) | undefined;

			const result = await ctx.ui.custom<PanelResult>((tui, theme, _keybindings, done) => {
				const panel = new ProductionizePanel(
					state,
					theme,
					done,
					() => controller.abort(),
				);
				requestRender = () => {
					panel.invalidate();
					tui.requestRender();
				};

				void runWorkflow(pi, ctx, state, controller.signal, () => requestRender?.()).catch((error) => {
					if (controller.signal.aborted || state.cancelRequested) {
						state.outcome = "cancelled";
						state.status = "Productionize cancelled.";
						markRunningCancelled(state);
					} else {
						const failure = unknownFailure("branch", "Workflow", error);
						state.outcome = "failed";
						state.failure = failure.failure;
						state.fixInstruction = fallbackFixInstruction(failure.failure);
					}
					requestRender?.();
				});

				return panel;
			});

			if (result?.action === "fix") {
				ctx.ui.setEditorText(result.instruction);
				ctx.ui.notify("Productionize fix instruction pasted. Submit when ready.", "info");
			}
		},
	});
}
