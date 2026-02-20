import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { Type, type Static } from "@sinclair/typebox";

import { createPlanController } from "./controller.js";
import {
	buildExecutionKickoffMessage,
	buildExecutionSystemPrompt,
	getAssistantText,
	isAssistantMessage,
	PLAN_SYSTEM_PROMPT,
} from "./messages.js";
import { showPlanOverlay } from "./overlay.js";
import type { NewSessionPlanPayload, PlanStep } from "./types.js";
import { extractPlanSteps, isSafeReadOnlyBashCommand, markCompletedSteps, saveApprovedPlan } from "./utils.js";

const PresentPlanParams = Type.Object({
	title: Type.String({ description: "Short title for the plan" }),
	planMarkdown: Type.String({ description: "Full markdown content of the plan" }),
});

interface PresentPlanDetails {
	decision: "approve_new_session" | "proceed_keep_context" | "refine" | "cancel";
	feedback?: string;
	savedPath?: string;
	stepCount: number;
}

export default function planModeExtension(pi: ExtensionAPI): void {
	const controller = createPlanController(pi);

	async function persistApprovedPlan(
		ctx: ExtensionContext,
		title: string,
		markdown: string,
		steps: PlanStep[],
		decision: "new_session" | "keep_context",
	): Promise<NewSessionPlanPayload> {
		const saved = await saveApprovedPlan({
			cwd: ctx.cwd,
			title,
			markdown,
			decision,
			sessionFile: ctx.sessionManager.getSessionFile(),
		});

		controller.setLatestPlan({
			title,
			markdown,
			createdAt: Date.now(),
			savedPath: saved.relativePath,
		});

		return {
			title,
			markdown,
			steps,
			savedPath: saved.relativePath,
		};
	}

	async function startFreshSessionWithPlan(ctx: ExtensionCommandContext, payload: NewSessionPlanPayload): Promise<void> {
		const parentSession = ctx.sessionManager.getSessionFile();
		const newSessionResult = await ctx.newSession({ parentSession });
		if (newSessionResult.cancelled) {
			ctx.ui.notify("New session creation cancelled", "warning");
			return;
		}

		controller.setLatestPlan({
			title: payload.title,
			markdown: payload.markdown,
			createdAt: Date.now(),
			savedPath: payload.savedPath,
		});
		controller.startExecutionMode(ctx, payload.steps);
		pi.sendUserMessage(buildExecutionKickoffMessage(payload));
		ctx.ui.notify("Started fresh session from approved plan", "info");
	}

	pi.registerCommand("plan", {
		description: "Toggle plan mode (xhigh + read-only planning)",
		handler: async (args, ctx) => {
			if (controller.isPlanModeEnabled()) {
				controller.disablePlanMode(ctx);
				return;
			}

			controller.enablePlanMode(ctx);
			const prompt = args.trim();
			if (prompt) pi.sendUserMessage(prompt);
		},
	});

	pi.registerCommand("plan-view", {
		description: "Re-open the latest plan review overlay",
		handler: async (_args, ctx) => {
			const latestPlan = controller.getLatestPlan();
			if (!latestPlan) {
				ctx.ui.notify("No plan available yet. Generate one first.", "warning");
				return;
			}

			const steps = controller.getTodoItems().length > 0
				? controller.getTodoItems().map((step) => ({ ...step }))
				: extractPlanSteps(latestPlan.markdown);

			const decision = await showPlanOverlay(ctx, {
				title: latestPlan.title,
				markdown: latestPlan.markdown,
				steps,
			});

			if (decision.decision === "cancel") return;
			if (decision.decision === "refine") {
				if (decision.feedback?.trim()) {
					pi.sendUserMessage(
						`Refine the current plan using this feedback:\n\n${decision.feedback.trim()}\n\nThen call present_plan again with the full revised plan.`,
					);
				}
				return;
			}

			try {
				const payload = await persistApprovedPlan(
					ctx,
					latestPlan.title,
					latestPlan.markdown,
					steps,
					decision.decision === "approve_new_session" ? "new_session" : "keep_context",
				);

				if (decision.decision === "approve_new_session") {
					await startFreshSessionWithPlan(ctx, payload);
					return;
				}

				controller.startExecutionMode(ctx, payload.steps);
				pi.sendUserMessage(buildExecutionKickoffMessage(payload));
				ctx.ui.notify(`Plan saved to ${payload.savedPath}`, "info");
			} catch (error) {
				ctx.ui.notify(`Failed to save plan: ${(error as Error).message}`, "error");
			}
		},
	});

	pi.registerCommand("plan-apply-new-session", {
		description: "Internal command to start a fresh session from an approved plan",
		handler: async (_args, ctx) => {
			const pending = controller.consumePendingNewSessionPlan();
			if (!pending) {
				ctx.ui.notify("No approved plan is pending for a new session", "warning");
				return;
			}
			await startFreshSessionWithPlan(ctx, pending);
		},
	});

	pi.registerShortcut(Key.shift("tab"), {
		description: "Cycle plan mode",
		handler: async (ctx) => {
			if (controller.isPlanModeEnabled() && controller.getLatestPlan()) {
				pi.sendUserMessage("/plan-view");
				return;
			}
			if (controller.isPlanModeEnabled()) controller.disablePlanMode(ctx);
			else controller.enablePlanMode(ctx);
		},
	});

	pi.registerTool<typeof PresentPlanParams, PresentPlanDetails>({
		name: "present_plan",
		label: "Present Plan",
		description:
			"Present a plan in an interactive overlay for review. User can refine, approve with new session, or proceed in current session.",
		parameters: PresentPlanParams,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					isError: true,
					content: [{ type: "text", text: "present_plan requires interactive UI mode." }],
					details: { decision: "cancel", stepCount: 0 },
				};
			}

			const input = params as Static<typeof PresentPlanParams>;
			const title = input.title.trim() || "Implementation Plan";
			const markdown = input.planMarkdown.trim();
			if (!markdown) {
				return {
					isError: true,
					content: [{ type: "text", text: "Plan markdown is empty. Provide the full plan markdown." }],
					details: { decision: "cancel", stepCount: 0 },
				};
			}

			const steps = extractPlanSteps(markdown);
			controller.setLatestPlan({ title, markdown, createdAt: Date.now() });

			const decision = await showPlanOverlay(ctx, { title, markdown, steps });
			if (decision.decision === "cancel") {
				return {
					content: [{ type: "text", text: "Plan presentation dismissed. Continue refining and present again when ready." }],
					details: { decision: "cancel", stepCount: steps.length },
				};
			}

			if (decision.decision === "refine") {
				const feedback = decision.feedback?.trim();
				const text = feedback
					? `User feedback:\n${feedback}\n\nRevise the plan and call present_plan again with the full updated plan.`
					: "User requested further refinement. Revise the plan and call present_plan again.";
				return {
					content: [{ type: "text", text }],
					details: { decision: "refine", feedback, stepCount: steps.length },
				};
			}

			try {
				const payload = await persistApprovedPlan(
					ctx,
					title,
					markdown,
					steps,
					decision.decision === "approve_new_session" ? "new_session" : "keep_context",
				);

				if (decision.decision === "approve_new_session") {
					controller.setPendingNewSessionPlan(payload);
					pi.sendUserMessage("/plan-apply-new-session", { deliverAs: "followUp" });
					return {
						content: [
							{
								type: "text",
								text: `Plan approved. Saved to ${payload.savedPath}. Starting a fresh session with this approved plan.`,
							},
						],
						details: { decision: "approve_new_session", savedPath: payload.savedPath, stepCount: steps.length },
					};
				}

				controller.startExecutionMode(ctx, steps);
				return {
					content: [{ type: "text", text: buildExecutionKickoffMessage(payload) }],
					details: { decision: "proceed_keep_context", savedPath: payload.savedPath, stepCount: steps.length },
				};
			} catch (error) {
				return {
					isError: true,
					content: [{ type: "text", text: `Failed to save approved plan: ${(error as Error).message}` }],
					details: { decision: "cancel", stepCount: steps.length },
				};
			}
		},
	});

	pi.on("tool_call", async (event) => {
		if (!controller.isPlanModeEnabled()) return;

		const allowedTools = new Set(controller.resolvePlanTools());
		if (!allowedTools.has(event.toolName)) {
			return {
				block: true,
				reason: `Plan mode only allows these tools: ${Array.from(allowedTools).join(", ")}.`,
			};
		}

		if (isToolCallEventType("bash", event) && !isSafeReadOnlyBashCommand(event.input.command)) {
			return {
				block: true,
				reason: `Plan mode blocked bash command (not read-only allowlisted): ${event.input.command}`,
			};
		}
	});

	pi.on("before_agent_start", async (event) => {
		if (controller.isPlanModeEnabled()) {
			return { systemPrompt: `${event.systemPrompt}\n\n${PLAN_SYSTEM_PROMPT}` };
		}
		if (controller.isExecutionMode()) {
			return { systemPrompt: `${event.systemPrompt}\n\n${buildExecutionSystemPrompt(controller.getTodoItems())}` };
		}
	});

	pi.on("turn_end", async (event, ctx) => {
		const todoItems = controller.getTodoItems();
		if (!controller.isExecutionMode() || todoItems.length === 0) return;
		if (!isAssistantMessage(event.message)) return;

		const text = getAssistantText(event.message);
		const changed = markCompletedSteps(text, todoItems);
		if (changed > 0) {
			controller.refreshStatusUi(ctx);
			controller.persistState();
		}

		if (!todoItems.every((step) => step.completed)) return;
		const completedSummary = todoItems.map((step) => `- [x] ${step.step}. ${step.text}`).join("\n");
		controller.stopExecutionMode(ctx);
		pi.sendMessage(
			{
				customType: "plan-mode",
				content: `✅ Approved plan complete.\n\n${completedSummary}`,
				display: true,
			},
			{ triggerTurn: false },
		);
	});

	pi.on("session_start", async (_event, ctx) => {
		controller.loadFromSession(ctx);
		controller.refreshStatusUi(ctx);
	});
}
