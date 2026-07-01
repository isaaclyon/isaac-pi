import {
	cloneDefaultSteps,
	type ChangedFile,
	type CommandFailure,
	type DisplayCheck,
	type StepId,
	type WorkflowStep,
} from "./core.ts";

export const PRODUCTIONIZE_STATE_CUSTOM_TYPE = "productionize-auto-state";

export type WorkflowOutcomeValue = "running" | "succeeded" | "failed" | "cancelled";

export interface PersistedPrInfo {
	number: number;
	title: string;
	url: string;
	headRefName: string;
	headRefOid: string;
}

export interface ProductionizeAutoState {
	enabled: boolean;
	reconstructed: boolean;
	startTimestamp?: string;
	activeCheckpoint?: StepId;
	resumeFromCheckpoint?: StepId;
	startFromCheckpoint?: StepId;
	stopAfterCheckpoint?: StepId;
	lastPersistedAt?: string;
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
	cancelRequested: boolean;
	auto: ProductionizeAutoState;
}

export interface ProductionizePersistedStateEntry {
	kind: "run-state";
	version: 1;
	persistedAt: string;
	state: ProductionizeStateSnapshot;
}

export interface SessionEntryLike {
	type?: string;
	customType?: string;
	data?: unknown;
}

const STEP_ORDER: StepId[] = ["branch", "commit", "push", "pr", "ci", "merge", "return"];

export function createDefaultAutoState(enabled = false): ProductionizeAutoState {
	return {
		enabled,
		reconstructed: false,
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

export function reconstructAutoState(entries: SessionEntryLike[]): { state?: ProductionizeStateSnapshot } {
	let latestState: ProductionizeStateSnapshot | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== PRODUCTIONIZE_STATE_CUSTOM_TYPE) continue;
		const data = entry.data as ProductionizePersistedStateEntry | undefined;
		if (!isPersistedStateEntry(data)) continue;
		latestState = clonePersistedState(data.state);
	}
	if (!latestState) return {};
	latestState.auto = {
		...latestState.auto,
		reconstructed: true,
	};
	return { state: latestState };
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

export function prepareStateForModelRun(state: ProductionizeStateSnapshot): ProductionizeStateSnapshot {
	const next = cloneSnapshot(state);
	next.auto.resumeFromCheckpoint = resumeCheckpointAfterInBandFix(next.auto.resumeFromCheckpoint);
	next.auto.activeCheckpoint = undefined;
	next.outcome = "running";
	next.status = next.auto.resumeFromCheckpoint
		? `Resuming productionize from ${next.auto.resumeFromCheckpoint}...`
		: "Starting productionize auto mode...";
	next.failure = undefined;
	next.cancelRequested = false;
	next.auto.enabled = true;
	return next;
}

function resumeCheckpointAfterInBandFix(checkpoint?: StepId): StepId | undefined {
	if (!checkpoint) return undefined;
	if (checkpoint === "branch" || checkpoint === "commit" || checkpoint === "return") return checkpoint;
	return "commit";
}

function isStepId(value: string): value is StepId {
	return STEP_ORDER.includes(value as StepId);
}

function isPersistedStateEntry(value: unknown): value is ProductionizePersistedStateEntry {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<ProductionizePersistedStateEntry>;
	return candidate.kind === "run-state" && candidate.version === 1 && Boolean(candidate.state);
}

function clonePersistedState(state: ProductionizeStateSnapshot): ProductionizeStateSnapshot {
	return {
		steps: (state.steps ?? []).map((step) => ({ ...step })),
		checks: (state.checks ?? []).map((check) => ({ ...check })),
		log: [...(state.log ?? [])],
		outcome: state.outcome ?? "running",
		status: state.status ?? "Starting productionize...",
		branch: state.branch,
		baseBranch: state.baseBranch,
		returnToBranch: state.returnToBranch,
		returnWarning: state.returnWarning,
		remote: state.remote,
		pr: state.pr ? { ...state.pr } : undefined,
		changedFiles: (state.changedFiles ?? []).map((file) => ({ ...file })),
		failure: state.failure ? { ...state.failure } : undefined,
		cancelRequested: Boolean(state.cancelRequested),
			auto: {
				enabled: Boolean(state.auto?.enabled),
				reconstructed: Boolean(state.auto?.reconstructed),
				startTimestamp: state.auto?.startTimestamp,
				activeCheckpoint: state.auto?.activeCheckpoint,
				resumeFromCheckpoint: state.auto?.resumeFromCheckpoint,
				startFromCheckpoint: state.auto?.startFromCheckpoint,
				stopAfterCheckpoint: state.auto?.stopAfterCheckpoint,
				lastPersistedAt: state.auto?.lastPersistedAt,
			},
	};
}
