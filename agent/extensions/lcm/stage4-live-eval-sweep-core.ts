import type { GateResult, LiveEvalMode, LiveEvalReasoning } from "./stage4-live-eval-core.ts";

export type SweepRunRetrieval = {
	mode: LiveEvalMode;
	used: boolean;
	toolCallCount: number;
	toolNames: string[];
	steps: number;
	toolErrorCount: number;
};

export type SweepRunResult = {
	effort: LiveEvalReasoning;
	runNumber: number;
	recall: number;
	gateOk: boolean;
	executionError?: string;
	report?: unknown;
	retrieval?: SweepRunRetrieval;
};

export type EffortSweepStats = {
	effort: LiveEvalReasoning;
	runCount: number;
	meanRecall: number;
	minRecall: number;
	maxRecall: number;
	passCount: number;
	failCount: number;
	errorCount: number;
	retrievalUsedCount: number;
	retrievalUsageRate: number;
	retrievalToolCallCount: number;
	retrievalToolErrorCount: number;
	retrievalToolNames: string[];
};

export type SweepSummary = {
	provider: string;
	modelId: string;
	config: {
		minRecall: number;
		runsPerEffort: number;
		efforts: LiveEvalReasoning[];
		retrievalMode: LiveEvalMode;
	};
	timing: {
		startedAt: string;
		finishedAt: string;
		durationMs: number;
		totalRuns: number;
	};
	runs: SweepRunResult[];
	byEffort: EffortSweepStats[];
	gate: GateResult;
};

export type RunsByEffort = Record<LiveEvalReasoning, SweepRunResult[]>;

export function groupRunsByEffort(
	runs: SweepRunResult[],
	efforts: LiveEvalReasoning[],
): RunsByEffort {
	const grouped = Object.create(null) as RunsByEffort;
	for (const effort of efforts) {
		grouped[effort] = [];
	}
	for (const run of runs) {
		if (!grouped[run.effort]) {
			grouped[run.effort] = [];
		}
		grouped[run.effort].push(run);
	}
	return grouped;
}

export function computeEffortStats(
	runsByEffort: RunsByEffort,
	minRecallThreshold: number,
): EffortSweepStats[] {
	const results: EffortSweepStats[] = [];
	for (const effort of Object.keys(runsByEffort) as LiveEvalReasoning[]) {
		const runs = runsByEffort[effort];
		const recalls = runs.map((run) => run.recall);
		const runCount = runs.length;
		const sum = recalls.reduce((acc, value) => acc + value, 0);
		const meanRecall = runCount > 0 ? sum / runCount : 0;
		const minRecall = runCount > 0 ? Math.min(...recalls) : 0;
		const maxRecall = runCount > 0 ? Math.max(...recalls) : 0;
		const passCount = runs.filter((run) => run.recall >= minRecallThreshold).length;
		const errorCount = runs.filter((run) => typeof run.executionError === "string" && run.executionError.length > 0).length;
		const retrievalUsedCount = runs.filter((run) => run.retrieval?.used === true).length;
		const retrievalToolCallCount = runs.reduce((acc, run) => acc + (run.retrieval?.toolCallCount ?? 0), 0);
		const retrievalToolErrorCount = runs.reduce((acc, run) => acc + (run.retrieval?.toolErrorCount ?? 0), 0);
		const toolNames = new Set<string>();
		for (const run of runs) {
			for (const name of run.retrieval?.toolNames ?? []) {
				if (typeof name === "string" && name.trim()) {
					toolNames.add(name.trim());
				}
			}
		}
		results.push({
			effort,
			runCount,
			meanRecall,
			minRecall,
			maxRecall,
			passCount,
			failCount: runCount - passCount,
			errorCount,
			retrievalUsedCount,
			retrievalUsageRate: runCount > 0 ? retrievalUsedCount / runCount : 0,
			retrievalToolCallCount,
			retrievalToolErrorCount,
			retrievalToolNames: [...toolNames].sort(),
		});
	}
	return results;
}

export function evaluateSweepMeanGate(
	effortStats: EffortSweepStats[],
	minRecallThreshold: number,
): GateResult {
	const reasons: string[] = [];
	for (const stats of effortStats) {
		if (stats.meanRecall < minRecallThreshold) {
			reasons.push(
				`${stats.effort} mean recall below threshold: ${(stats.meanRecall * 100).toFixed(1)}% < ${(minRecallThreshold * 100).toFixed(1)}%`,
			);
		}
	}
	return {
		ok: reasons.length === 0,
		reasons,
	};
}

export function buildSweepSummary(input: {
	provider: string;
	modelId: string;
	minRecall: number;
	runsPerEffort: number;
	efforts: LiveEvalReasoning[];
	retrievalMode: LiveEvalMode;
	startedAt: string;
	finishedAt: string;
	runResults: SweepRunResult[];
	effortStats: EffortSweepStats[];
	gate: GateResult;
}): SweepSummary {
	const durationMs = Math.max(0, Date.parse(input.finishedAt) - Date.parse(input.startedAt));
	return {
		provider: input.provider,
		modelId: input.modelId,
		config: {
			minRecall: input.minRecall,
			runsPerEffort: input.runsPerEffort,
			efforts: input.efforts,
			retrievalMode: input.retrievalMode,
		},
		timing: {
			startedAt: input.startedAt,
			finishedAt: input.finishedAt,
			durationMs,
			totalRuns: input.runResults.length,
		},
		runs: input.runResults,
		byEffort: input.effortStats,
		gate: input.gate,
	};
}
