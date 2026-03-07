export type RalphRunState =
	| "running"
	| "succeeded"
	| "failed"
	| "stopped"
	| "max_loops_reached";

export type RalphSuccessMode = "deterministic-tdd" | "quantitative" | "hybrid" | "qualitative";

export type RalphBudgetConfig = {
	contextThresholdPercent: number;
	maxAssistantTurns: number | null;
	maxToolCalls: number | null;
};

export type RalphDeterministicSuccessConfig = {
	mode: "deterministic-tdd";
	mustFail: string[];
	mustPass: string[];
};

export type RalphQuantitativeCheck = {
	command: string;
	expectedExitCode?: number;
	stdoutIncludes?: string;
	stdoutExcludes?: string;
	stderrIncludes?: string;
	stderrExcludes?: string;
};

export type RalphQuantitativeSuccessConfig = {
	mode: "quantitative";
	checks: RalphQuantitativeCheck[];
};

export type RalphQualitativeSuccessConfig = {
	mode: "qualitative";
	allowStandalone?: boolean;
	notes?: string;
};

export type RalphHybridSuccessConfig = {
	mode: "hybrid";
	deterministic?: Omit<RalphDeterministicSuccessConfig, "mode">;
	quantitative?: Omit<RalphQuantitativeSuccessConfig, "mode">;
	qualitative?: Omit<RalphQualitativeSuccessConfig, "mode">;
};

export type RalphSuccessConfig =
	| RalphDeterministicSuccessConfig
	| RalphQuantitativeSuccessConfig
	| RalphHybridSuccessConfig
	| RalphQualitativeSuccessConfig;

export type RalphRunnerConfig = {
	cwd: string;
	model: string | null;
	tools: string[] | null;
	tmuxSessionPrefix: string;
};

export type RalphRunConfig = {
	task: string;
	maxLoops: number;
	budget: RalphBudgetConfig;
	success: RalphSuccessConfig;
	runner: RalphRunnerConfig;
};

export type RalphExtensionConfig = {
	enabled: boolean;
	dbPath: string;
	defaultRun: RalphRunConfig;
};

export type RalphRunRecord = {
	runId: string;
	state: RalphRunState;
	task: string;
	maxLoops: number;
	activeLoop: number;
	configJson: string;
	createdAt: number;
	updatedAt: number;
};

export type RalphLoopRecord = {
	loopId: number;
	runId: string;
	loopNumber: number;
	state: "running" | "completed" | "failed" | "stopped";
	triggerReason: string | null;
	startedAt: number;
	endedAt: number | null;
	summary: string | null;
	checkpointJson: string | null;
};

export type RalphCheckpointInput = {
	runId: string;
	loopNumber: number;
	triggerReason: string;
	summary: string;
	artifactsJson: string;
	nextPrompt: string;
	createdAt: number;
};

export type RalphEventInput = {
	runId: string;
	loopId?: number;
	eventType: string;
	payloadJson: string;
	createdAt: number;
};
