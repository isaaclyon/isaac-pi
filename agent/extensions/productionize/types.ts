import type { CommandFailure, StepId } from "./core.ts";
import type { PersistedPrInfo, ProductionizeStateSnapshot, WorkflowOutcomeValue } from "./auto.ts";

export type PanelResult = { action: "close" } | { action: "fix"; instruction: string };
export type WorkflowOutcome = WorkflowOutcomeValue;

export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
	killed?: boolean;
}

export interface PrInfo extends PersistedPrInfo {}

export interface ProductionizeState extends ProductionizeStateSnapshot {}

export class WorkflowFailure extends Error {
	readonly stepId: StepId;
	readonly failure: CommandFailure;

	constructor(stepId: StepId, failure: CommandFailure) {
		super(failure.message ?? `${failure.step} failed`);
		this.stepId = stepId;
		this.failure = failure;
	}
}
