import {
	cloneDefaultSteps,
	type ChangedFile,
	type CommandFailure,
	type DisplayCheck,
	type StepId,
	type WorkflowStep,
} from "./core.ts";

export const PRODUCTIONIZE_STATE_CUSTOM_TYPE = "productionize-auto-state";
export const PRODUCTIONIZE_SUMMARY_MESSAGE_TYPE = "productionize-auto-summary";
export const AUTO_RETRY_LIMIT = 3;

export type WorkflowOutcomeValue = "running" | "succeeded" | "failed" | "cancelled";
export type RepairAttemptOutcome = "succeeded" | "failed" | "cancelled";
export type RepairAttemptStatus = "starting" | "running" | "importing" | "resuming" | "succeeded" | "failed" | "cancelled";

export interface PersistedPrInfo {
	number: number;
	title: string;
	url: string;
	headRefName: string;
	headRefOid: string;
}

export interface RepairSummaryEntry {
	stepId: StepId;
	attempt: number;
	headShaBefore: string;
	headShaAfter?: string;
	outcome: RepairAttemptOutcome;
	sessionFile: string;
	persistedAt: string;
	summary: string;
}

export interface ActiveRepairState {
	stepId: StepId;
	attempt: number;
	maxAttempts: number;
	status: RepairAttemptStatus;
	headShaBefore?: string;
	headShaAfter?: string;
	baseBranch?: string;
	baseShaBefore?: string;
	sessionFile?: string;
	lastPrompt?: string;
	childToken?: string;
	spawnTimestamp?: string;
	pid?: number;
	verifiedCommand?: {
		command: string;
		args: string[];
		cwd: string;
		tools: string[];
	};
	tempWorktree?: string;
	lastSeenEventType?: string;
	lastSummarizedText?: string;
	resumeCheckpoint?: StepId;
	errorMessage?: string;
}

export interface ProductionizeAutoState {
	enabled: boolean;
	reconstructed: boolean;
	startTimestamp?: string;
	activeCheckpoint?: StepId;
	resumeFromCheckpoint?: StepId;
	retryCounts: Record<string, number>;
	latestHandoffPrompt?: string;
	latestSideSessionFile?: string;
	lastPersistedAt?: string;
	currentRepair?: ActiveRepairState;
	lastRepairSummary?: RepairSummaryEntry;
	repairHistory: RepairSummaryEntry[];
}

export interface ProductionizeStateSnapshot {
	steps: WorkflowStep[];
	checks: DisplayCheck[];
	log: string[];
	outcome: WorkflowOutcomeValue;
	status: string;
	branch?: string;
	baseBranch?: string;
	returnToBranch?: string;
	returnWarning?: string;
	remote?: string;
	pr?: PersistedPrInfo;
	changedFiles: ChangedFile[];
	failure?: CommandFailure;
	fixInstruction?: string;
	cancelRequested: boolean;
	auto: ProductionizeAutoState;
}

export interface ProductionizePersistedStateEntry {
	kind: "run-state";
	version: 1;
	persistedAt: string;
	state: ProductionizeStateSnapshot;
}

export interface ProductionizePersistedSummaryEntry {
	kind: "repair-summary";
	version: 1;
	persistedAt: string;
	summary: RepairSummaryEntry;
}

export type ProductionizePersistedEntry = ProductionizePersistedStateEntry | ProductionizePersistedSummaryEntry;

export interface SessionEntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
}

export interface ResumePlan {
	resumeFrom: StepId;
	clearSteps: StepId[];
	clearPr: boolean;
	clearChecks: boolean;
}

const STEP_ORDER: StepId[] = ["branch", "commit", "push", "pr", "ci", "merge", "return"];
const DOWNSTREAM_AFTER_PUSH: StepId[] = ["pr", "ci", "merge", "return"];
const DOWNSTREAM_AFTER_PR: StepId[] = ["ci", "merge", "return"];

export function createDefaultAutoState(enabled = false): ProductionizeAutoState {
	return {
		enabled,
		reconstructed: false,
		retryCounts: {},
		repairHistory: [],
	};
}

export function parseProductionizeArgs(args: string): { auto: boolean; targetStep?: StepId; usageError?: string } {
	const tokens = args
		.trim()
		.split(/\s+/)
		.filter(Boolean);
	if (tokens.length === 0) return { auto: false };
	if (tokens.length === 1) {
		const token = tokens[0]?.toLowerCase();
		if (token === "auto") return { auto: true };
		if (isStepId(token)) return { auto: false, targetStep: token };
	}
	return { auto: false, usageError: "Usage: /productionize [auto|branch|commit|push|pr|ci|merge|return]" };
}

export function buildRetryKey(stepId: StepId, headSha: string): string {
	return `${stepId}:${headSha.trim()}`;
}

export function nextAttemptNumber(retryCounts: Record<string, number>, key: string): number {
	return (retryCounts[key] ?? 0) + 1;
}

export function recordRetryAttempt(retryCounts: Record<string, number>, key: string): Record<string, number> {
	return { ...retryCounts, [key]: nextAttemptNumber(retryCounts, key) };
}

export function decideResumePlan(stepId: StepId, headChanged: boolean): ResumePlan {
	switch (stepId) {
		case "branch":
			return { resumeFrom: "branch", clearSteps: [...STEP_ORDER.slice(1)], clearPr: true, clearChecks: true };
		case "commit":
			return {
				resumeFrom: "commit",
				clearSteps: headChanged ? [...STEP_ORDER.slice(2)] : [],
				clearPr: headChanged,
				clearChecks: headChanged,
			};
		case "push":
			return {
				resumeFrom: "push",
				clearSteps: headChanged ? [...DOWNSTREAM_AFTER_PUSH] : [],
				clearPr: headChanged,
				clearChecks: headChanged,
			};
		case "pr":
			return { resumeFrom: "pr", clearSteps: [...DOWNSTREAM_AFTER_PR], clearPr: true, clearChecks: true };
		case "ci":
			return headChanged
				? { resumeFrom: "push", clearSteps: [...DOWNSTREAM_AFTER_PUSH], clearPr: true, clearChecks: true }
				: { resumeFrom: "ci", clearSteps: [], clearPr: false, clearChecks: false };
		case "merge":
			return headChanged
				? { resumeFrom: "push", clearSteps: [...DOWNSTREAM_AFTER_PUSH], clearPr: true, clearChecks: true }
				: { resumeFrom: "merge", clearSteps: [], clearPr: false, clearChecks: false };
		case "return":
			return headChanged
				? { resumeFrom: "push", clearSteps: [...DOWNSTREAM_AFTER_PUSH], clearPr: true, clearChecks: true }
				: { resumeFrom: "return", clearSteps: [], clearPr: false, clearChecks: false };
	}
}

export function invalidateForResume(state: ProductionizeStateSnapshot, plan: ResumePlan): ProductionizeStateSnapshot {
	const nextSteps = state.steps.map((step) => {
		if (step.id === plan.resumeFrom) return { ...step, status: "pending" as const, detail: undefined };
		if (plan.clearSteps.includes(step.id)) return { ...step, status: "pending" as const, detail: undefined };
		return { ...step };
	});
	return {
		...state,
		steps: nextSteps,
		checks: plan.clearChecks ? [] : [...state.checks],
		pr: plan.clearPr ? undefined : state.pr,
		status: `Resuming from ${plan.resumeFrom}...`,
		failure: undefined,
		fixInstruction: undefined,
		auto: {
			...state.auto,
			activeCheckpoint: plan.resumeFrom,
			resumeFromCheckpoint: plan.resumeFrom,
			currentRepair: state.auto.currentRepair
				? { ...state.auto.currentRepair, resumeCheckpoint: plan.resumeFrom }
				: undefined,
		},
	};
}

export function cloneSnapshot(state: ProductionizeStateSnapshot): ProductionizeStateSnapshot {
	return JSON.parse(JSON.stringify(state)) as ProductionizeStateSnapshot;
}

export function serializeStateEntry(state: ProductionizeStateSnapshot, persistedAt = new Date().toISOString()): ProductionizePersistedStateEntry {
	return {
		kind: "run-state",
		version: 1,
		persistedAt,
		state: cloneSnapshot(state),
	};
}

export function serializeSummaryEntry(summary: RepairSummaryEntry, persistedAt = new Date().toISOString()): ProductionizePersistedSummaryEntry {
	return {
		kind: "repair-summary",
		version: 1,
		persistedAt,
		summary: { ...summary, persistedAt },
	};
}

export function reconstructAutoState(entries: SessionEntryLike[]): { state?: ProductionizeStateSnapshot; summaries: RepairSummaryEntry[] } {
	let latestState: ProductionizeStateSnapshot | undefined;
	const summaries: RepairSummaryEntry[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== PRODUCTIONIZE_STATE_CUSTOM_TYPE) continue;
		const data = entry.data as ProductionizePersistedEntry | undefined;
		if (!isPersistedEntry(data)) continue;
		if (data.kind === "run-state") latestState = clonePersistedState(data.state);
		if (data.kind === "repair-summary") summaries.push({ ...data.summary });
	}
	if (!latestState) return { summaries };
	latestState.auto = {
		...latestState.auto,
		reconstructed: true,
		repairHistory: summaries,
		lastRepairSummary: summaries.at(-1) ?? latestState.auto.lastRepairSummary,
	};
	return { state: latestState, summaries };
}

export function createDefaultSnapshot(enabled = false): ProductionizeStateSnapshot {
	return {
		steps: cloneDefaultSteps(),
		checks: [],
		log: [],
		outcome: "running",
		status: "Starting productionize...",
		changedFiles: [],
		cancelRequested: false,
		auto: createDefaultAutoState(enabled),
	};
}

function isStepId(value: string): value is StepId {
	return STEP_ORDER.includes(value as StepId);
}

function isPersistedEntry(value: unknown): value is ProductionizePersistedEntry {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<ProductionizePersistedEntry>;
	return candidate.kind === "run-state" || candidate.kind === "repair-summary";
}

function clonePersistedState(state: ProductionizeStateSnapshot): ProductionizeStateSnapshot {
	return {
		...state,
		steps: (state.steps ?? []).map((step) => ({ ...step })),
		checks: (state.checks ?? []).map((check) => ({ ...check })),
		log: [...(state.log ?? [])],
		changedFiles: (state.changedFiles ?? []).map((file) => ({ ...file })),
		failure: state.failure ? { ...state.failure } : undefined,
		pr: state.pr ? { ...state.pr } : undefined,
		auto: {
			...createDefaultAutoState(Boolean(state.auto?.enabled)),
			...state.auto,
			retryCounts: { ...(state.auto?.retryCounts ?? {}) },
			repairHistory: (state.auto?.repairHistory ?? []).map((summary) => ({ ...summary })),
			lastRepairSummary: state.auto?.lastRepairSummary ? { ...state.auto.lastRepairSummary } : undefined,
			currentRepair: state.auto?.currentRepair
				? {
					...state.auto.currentRepair,
					verifiedCommand: state.auto.currentRepair.verifiedCommand
						? {
							command: state.auto.currentRepair.verifiedCommand.command,
							args: [...state.auto.currentRepair.verifiedCommand.args],
							cwd: state.auto.currentRepair.verifiedCommand.cwd,
							tools: [...state.auto.currentRepair.verifiedCommand.tools],
						}
						: undefined,
				}
				: undefined,
		},
	};
}
