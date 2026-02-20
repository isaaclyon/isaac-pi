import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

export interface PlanStep {
	step: number;
	text: string;
	completed: boolean;
}

export interface StoredPlan {
	title: string;
	markdown: string;
	createdAt: number;
	savedPath?: string;
}

export type PlanOverlayDecision = "approve_new_session" | "proceed_keep_context" | "refine" | "cancel";

export interface PlanOverlayResult {
	decision: PlanOverlayDecision;
	feedback?: string;
}

export interface PlanModeStateData {
	planModeEnabled: boolean;
	executionMode: boolean;
	normalTools?: string[];
	normalThinking?: ThinkingLevel;
	latestPlan?: StoredPlan;
	todoItems?: PlanStep[];
}

export interface SaveApprovedPlanInput {
	cwd: string;
	title: string;
	markdown: string;
	decision: "new_session" | "keep_context";
	sessionFile?: string;
}

export interface SaveApprovedPlanResult {
	path: string;
	relativePath: string;
	filename: string;
}

export interface NewSessionPlanPayload {
	title: string;
	markdown: string;
	steps: PlanStep[];
	savedPath: string;
}
