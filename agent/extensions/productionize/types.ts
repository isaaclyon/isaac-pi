import type { ChangedFile, CommandFailure, DisplayCheck, WorkflowStep, StepId } from "./core.ts";

export type PanelResult = { action: "close" } | { action: "fix"; instruction: string };
export type WorkflowOutcome = "running" | "succeeded" | "failed" | "cancelled";

export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
	killed?: boolean;
}

export interface PrInfo {
	number: number;
	title: string;
	url: string;
	headRefName: string;
	headRefOid: string;
}

export interface ProductionizeState {
	steps: WorkflowStep[];
	checks: DisplayCheck[];
	log: string[];
	outcome: WorkflowOutcome;
	status: string;
	branch?: string;
	baseBranch?: string;
	returnToBranch?: string;
	returnWarning?: string;
	remote?: string;
	pr?: PrInfo;
	changedFiles: ChangedFile[];
	failure?: CommandFailure;
	fixInstruction?: string;
	cancelRequested: boolean;
}

export class WorkflowFailure extends Error {
	readonly stepId: StepId;
	readonly failure: CommandFailure;

	constructor(stepId: StepId, failure: CommandFailure) {
		super(failure.message ?? `${failure.step} failed`);
		this.stepId = stepId;
		this.failure = failure;
	}
}
