import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export type LiveEvalReasoning = "minimal" | "low" | "medium" | "high" | "xhigh";
export type LiveEvalMode = "summary-only" | "retrieval-aware";

export type LiveEvalConfig = {
	provider: string;
	modelId: string;
	reasoning: LiveEvalReasoning;
	minRecall: number;
	maxModelCalls: number;
	targetTokens: number;
	freshTailCount: number;
	leafChunkTokens: number;
	incrementalMaxDepth: number;
	retrievalMode: LiveEvalMode;
	retrievalMaxSteps: number;
	retrievalMaxToolCalls: number;
};

export type RecallScore = {
	found: string[];
	missing: string[];
	recall: number;
};

export type GateInput = {
	recall: number;
	modelCalls: number;
};

export type GateThresholds = {
	minRecall: number;
	maxModelCalls: number;
};

export type GateResult = {
	ok: boolean;
	reasons: string[];
};

function parseNumberEnv(
	env: Record<string, string | undefined>,
	key: string,
	fallback: number,
	validate: (value: number) => boolean,
	validationHint: string,
): number {
	const raw = env[key];
	if (raw === undefined || raw.trim() === "") {
		return fallback;
	}
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || !validate(parsed)) {
		throw new Error(`${key} invalid: ${raw}. Expected ${validationHint}.`);
	}
	return parsed;
}

function parseReasoningEnv(
	env: Record<string, string | undefined>,
	key: string,
	fallback: LiveEvalReasoning,
): LiveEvalReasoning {
	const raw = env[key];
	if (!raw || raw.trim() === "") {
		return fallback;
	}
	const value = raw.trim().toLowerCase();
	if (value === "minimal" || value === "low" || value === "medium" || value === "high" || value === "xhigh") {
		return value;
	}
	throw new Error(`${key} invalid: ${raw}. Expected one of: minimal, low, medium, high, xhigh.`);
}

function parseModeEnv(
	env: Record<string, string | undefined>,
	key: string,
	fallback: LiveEvalMode,
): LiveEvalMode {
	const raw = env[key];
	if (!raw || raw.trim() === "") {
		return fallback;
	}
	const value = raw.trim().toLowerCase();
	if (value === "summary-only" || value === "retrieval-aware") {
		return value;
	}
	throw new Error(`${key} invalid: ${raw}. Expected one of: summary-only, retrieval-aware.`);
}

export function resolveLiveEvalConfig(env: Record<string, string | undefined>): LiveEvalConfig {
	return {
		provider: env.PI_LCM_LIVE_EVAL_PROVIDER?.trim() || "openai-codex",
		modelId: env.PI_LCM_LIVE_EVAL_MODEL_ID?.trim() || "gpt-5.3-codex",
		reasoning: parseReasoningEnv(env, "PI_LCM_LIVE_EVAL_REASONING", "low"),
		minRecall: parseNumberEnv(env, "PI_LCM_LIVE_EVAL_MIN_RECALL", 0.67, (v) => v >= 0 && v <= 1, "a number in [0,1]"),
		maxModelCalls: parseNumberEnv(env, "PI_LCM_LIVE_EVAL_MAX_MODEL_CALLS", 5, (v) => Number.isInteger(v) && v >= 1, "an integer >= 1"),
		targetTokens: parseNumberEnv(env, "PI_LCM_LIVE_EVAL_TARGET_TOKENS", 200, (v) => Number.isInteger(v) && v >= 1, "an integer >= 1"),
		freshTailCount: parseNumberEnv(env, "PI_LCM_LIVE_EVAL_FRESH_TAIL_COUNT", 2, (v) => Number.isInteger(v) && v >= 1, "an integer >= 1"),
		leafChunkTokens: parseNumberEnv(env, "PI_LCM_LIVE_EVAL_LEAF_CHUNK_TOKENS", 300, (v) => Number.isInteger(v) && v >= 1, "an integer >= 1"),
		incrementalMaxDepth: parseNumberEnv(env, "PI_LCM_LIVE_EVAL_INCREMENTAL_MAX_DEPTH", 2, (v) => Number.isInteger(v) && v >= 0, "an integer >= 0"),
		retrievalMode: parseModeEnv(env, "PI_LCM_LIVE_EVAL_MODE", "summary-only"),
		retrievalMaxSteps: parseNumberEnv(env, "PI_LCM_LIVE_EVAL_RETRIEVAL_MAX_STEPS", 3, (v) => Number.isInteger(v) && v >= 1, "an integer >= 1"),
		retrievalMaxToolCalls: parseNumberEnv(env, "PI_LCM_LIVE_EVAL_RETRIEVAL_MAX_TOOL_CALLS", 6, (v) => Number.isInteger(v) && v >= 1, "an integer >= 1"),
	};
}

export function scoreRecall(expectedFacts: string[], modelAnswer: string): RecallScore {
	if (expectedFacts.length === 0) {
		return { found: [], missing: [], recall: 1 };
	}
	const haystack = modelAnswer.toLowerCase();
	const found: string[] = [];
	for (const fact of expectedFacts) {
		if (haystack.includes(fact.toLowerCase())) {
			found.push(fact);
		}
	}
	const missing = expectedFacts.filter((fact) => !found.includes(fact));
	return {
		found,
		missing,
		recall: found.length / expectedFacts.length,
	};
}

const PROVIDER_CREDENTIAL_ENV: Record<string, string[]> = {
	anthropic: ["ANTHROPIC_API_KEY"],
	openai: ["OPENAI_API_KEY"],
	"azure-openai-responses": ["AZURE_OPENAI_API_KEY", "AZURE_OPENAI_ENDPOINT"],
	openrouter: ["OPENROUTER_API_KEY"],
	google: ["GOOGLE_API_KEY"],
	"google-vertex": ["GOOGLE_APPLICATION_CREDENTIALS"],
	groq: ["GROQ_API_KEY"],
	xai: ["XAI_API_KEY"],
	mistral: ["MISTRAL_API_KEY"],
};

export function resolveProviderApiKey(
	provider: string,
	env: Record<string, string | undefined>,
): string | undefined {
	const explicit = env.PI_LCM_LIVE_EVAL_API_KEY?.trim();
	if (explicit) {
		return explicit;
	}
	if (provider !== "openai-codex") {
		return undefined;
	}
	const authPath =
		env.PI_LCM_LIVE_EVAL_CODEX_AUTH_PATH?.trim() ||
		(env.HOME ? join(env.HOME, ".codex", "auth.json") : undefined);
	if (!authPath || !existsSync(authPath)) {
		return undefined;
	}
	try {
		const raw = readFileSync(authPath, "utf-8");
		const parsed = JSON.parse(raw) as { tokens?: { access_token?: unknown } };
		const token = parsed?.tokens?.access_token;
		return typeof token === "string" && token.trim() ? token : undefined;
	} catch {
		return undefined;
	}
}

export function assertProviderCredentials(provider: string, env: Record<string, string | undefined>): void {
	if (provider === "openai-codex") {
		const token = resolveProviderApiKey(provider, env);
		if (!token) {
			throw new Error(
				"Missing OpenAI Codex OAuth token. Set PI_LCM_LIVE_EVAL_API_KEY or ensure ~/.codex/auth.json contains tokens.access_token.",
			);
		}
		return;
	}

	const required = PROVIDER_CREDENTIAL_ENV[provider] ?? [];
	if (required.length === 0) {
		return;
	}
	const missing = required.filter((key) => {
		const value = env[key];
		return value === undefined || value.trim() === "";
	});
	if (missing.length > 0) {
		throw new Error(
			`Missing credentials for provider '${provider}'. Set: ${missing.join(", ")}`,
		);
	}
}

export function evaluateLiveGate(metrics: GateInput, thresholds: GateThresholds): GateResult {
	const reasons: string[] = [];
	if (metrics.recall < thresholds.minRecall) {
		reasons.push(
			`recall below threshold: ${(metrics.recall * 100).toFixed(1)}% < ${(thresholds.minRecall * 100).toFixed(1)}%`,
		);
	}
	if (metrics.modelCalls > thresholds.maxModelCalls) {
		reasons.push(`model calls exceeded budget: ${metrics.modelCalls} > ${thresholds.maxModelCalls}`);
	}
	return {
		ok: reasons.length === 0,
		reasons,
	};
}
