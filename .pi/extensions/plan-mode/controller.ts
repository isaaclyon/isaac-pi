import type { ThinkingLevel } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";

import type { NewSessionPlanPayload, PlanModeStateData, PlanStep, StoredPlan } from "./types.js";

const STATE_ENTRY = "plan-mode-state-v2";
const PLAN_MODE_TOOLS = ["read", "bash", "grep", "find", "ls", "questionnaire", "present_plan"] as const;

function cloneSteps(steps: PlanStep[]): PlanStep[] {
	return steps.map((step) => ({ ...step }));
}

function formatChecklistLines(ctx: ExtensionContext, steps: PlanStep[]): string[] {
	return steps.map((step) => {
		const label = `${step.step}. ${step.text}`;
		if (step.completed) {
			return `${ctx.ui.theme.fg("success", "☑ ")}${ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(label))}`;
		}
		return `${ctx.ui.theme.fg("muted", "☐ ")}${label}`;
	});
}

interface RuntimeState {
	planModeEnabled: boolean;
	executionMode: boolean;
	normalThinking?: ThinkingLevel;
	normalTools?: string[];
	latestPlan?: StoredPlan;
	todoItems: PlanStep[];
	pendingNewSessionPlan?: NewSessionPlanPayload;
}

export interface PlanController {
	isPlanModeEnabled(): boolean;
	isExecutionMode(): boolean;
	getLatestPlan(): StoredPlan | undefined;
	getTodoItems(): PlanStep[];
	setLatestPlan(plan: StoredPlan): void;
	setPendingNewSessionPlan(plan: NewSessionPlanPayload): void;
	consumePendingNewSessionPlan(): NewSessionPlanPayload | undefined;
	resolvePlanTools(): string[];
	persistState(): void;
	restoreNormalRuntime(): void;
	refreshStatusUi(ctx: ExtensionContext): void;
	enablePlanMode(ctx: ExtensionContext): void;
	disablePlanMode(ctx: ExtensionContext): void;
	startExecutionMode(ctx: ExtensionContext, steps: PlanStep[]): void;
	stopExecutionMode(ctx: ExtensionContext): void;
	loadFromSession(ctx: ExtensionContext): void;
}

export function createPlanController(pi: ExtensionAPI): PlanController {
	const state: RuntimeState = {
		planModeEnabled: false,
		executionMode: false,
		todoItems: [],
	};

	function resolvePlanTools(): string[] {
		const available = new Set(pi.getAllTools().map((tool) => tool.name));
		return PLAN_MODE_TOOLS.filter((toolName) => available.has(toolName));
	}

	function persistState(): void {
		pi.appendEntry<PlanModeStateData>(STATE_ENTRY, {
			planModeEnabled: state.planModeEnabled,
			executionMode: state.executionMode,
			normalThinking: state.normalThinking,
			normalTools: state.normalTools,
			latestPlan: state.latestPlan,
			todoItems: state.todoItems,
		});
	}

	function restoreNormalRuntime(): void {
		if (state.normalTools && state.normalTools.length > 0) {
			pi.setActiveTools(state.normalTools);
		}
		if (state.normalThinking) {
			pi.setThinkingLevel(state.normalThinking);
		}
	}

	function refreshStatusUi(ctx: ExtensionContext): void {
		if (!ctx.hasUI) return;

		if (state.executionMode && state.todoItems.length > 0) {
			const completed = state.todoItems.filter((step) => step.completed).length;
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("accent", `📋 ${completed}/${state.todoItems.length}`));
			ctx.ui.setWidget("plan-mode-checklist", formatChecklistLines(ctx, state.todoItems));
			return;
		}

		if (state.planModeEnabled) {
			ctx.ui.setStatus("plan-mode", ctx.ui.theme.fg("warning", "⏸ plan mode (xhigh, read-only)"));
			ctx.ui.setWidget("plan-mode-checklist", undefined);
			return;
		}

		ctx.ui.setStatus("plan-mode", undefined);
		ctx.ui.setWidget("plan-mode-checklist", undefined);
	}

	function enablePlanMode(ctx: ExtensionContext): void {
		if (state.planModeEnabled) return;

		state.normalThinking ??= pi.getThinkingLevel();
		state.normalTools ??= [...pi.getActiveTools()];
		state.planModeEnabled = true;
		state.executionMode = false;
		state.todoItems = [];

		pi.setThinkingLevel("xhigh");
		pi.setActiveTools(resolvePlanTools());
		refreshStatusUi(ctx);
		persistState();
		ctx.ui.notify("Plan mode enabled", "info");
	}

	function disablePlanMode(ctx: ExtensionContext): void {
		if (!state.planModeEnabled) return;
		state.planModeEnabled = false;
		restoreNormalRuntime();
		refreshStatusUi(ctx);
		persistState();
		ctx.ui.notify("Plan mode disabled", "info");
	}

	function startExecutionMode(ctx: ExtensionContext, steps: PlanStep[]): void {
		state.planModeEnabled = false;
		state.executionMode = steps.length > 0;
		state.todoItems = cloneSteps(steps);
		restoreNormalRuntime();
		refreshStatusUi(ctx);
		persistState();
	}

	function stopExecutionMode(ctx: ExtensionContext): void {
		state.executionMode = false;
		state.todoItems = [];
		refreshStatusUi(ctx);
		persistState();
	}

	function setLatestPlan(plan: StoredPlan): void {
		state.latestPlan = plan;
		persistState();
	}

	function setPendingNewSessionPlan(plan: NewSessionPlanPayload): void {
		state.pendingNewSessionPlan = {
			...plan,
			steps: cloneSteps(plan.steps),
		};
	}

	function consumePendingNewSessionPlan(): NewSessionPlanPayload | undefined {
		const pending = state.pendingNewSessionPlan;
		state.pendingNewSessionPlan = undefined;
		if (!pending) return undefined;
		return {
			...pending,
			steps: cloneSteps(pending.steps),
		};
	}

	function loadFromSession(ctx: ExtensionContext): void {
		const entries = ctx.sessionManager.getEntries();
		for (let index = entries.length - 1; index >= 0; index--) {
			const entry = entries[index] as { type: string; customType?: string; data?: PlanModeStateData };
			if (entry.type !== "custom" || entry.customType !== STATE_ENTRY || !entry.data) continue;

			state.planModeEnabled = entry.data.planModeEnabled === true;
			state.executionMode = entry.data.executionMode === true;
			state.normalThinking = entry.data.normalThinking;
			state.normalTools = entry.data.normalTools;
			state.latestPlan = entry.data.latestPlan;
			state.todoItems = entry.data.todoItems ? cloneSteps(entry.data.todoItems) : [];
			break;
		}

		if (state.planModeEnabled) {
			pi.setThinkingLevel("xhigh");
			pi.setActiveTools(resolvePlanTools());
		} else {
			restoreNormalRuntime();
		}
	}

	return {
		isPlanModeEnabled: () => state.planModeEnabled,
		isExecutionMode: () => state.executionMode,
		getLatestPlan: () => state.latestPlan,
		getTodoItems: () => state.todoItems,
		setLatestPlan,
		setPendingNewSessionPlan,
		consumePendingNewSessionPlan,
		resolvePlanTools,
		persistState,
		restoreNormalRuntime,
		refreshStatusUi,
		enablePlanMode,
		disablePlanMode,
		startExecutionMode,
		stopExecutionMode,
		loadFromSession,
	};
}
