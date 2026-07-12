import { readFileSync } from "node:fs";

import type { ThinkingLevel } from "@earendil-works/pi-ai/compat";

export interface BranchSummaryModelSettings {
	provider: string;
	model: string;
	thinkingLevel: ThinkingLevel;
}

const DEFAULT_THINKING_LEVEL: ThinkingLevel = "low";
const VALID_THINKING_LEVELS = new Set<ThinkingLevel>(["minimal", "low", "medium", "high", "xhigh", "max"]);

export function parseBranchSummaryModelSettings(value: unknown): BranchSummaryModelSettings | undefined {
	if (!value || typeof value !== "object") return undefined;
	const candidate = value as Record<string, unknown>;
	if (typeof candidate.provider !== "string" || candidate.provider.trim() === "") return undefined;
	if (typeof candidate.model !== "string" || candidate.model.trim() === "") return undefined;

	const thinkingLevel = candidate.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
	if (typeof thinkingLevel !== "string" || !VALID_THINKING_LEVELS.has(thinkingLevel as ThinkingLevel)) return undefined;

	return {
		provider: candidate.provider.trim(),
		model: candidate.model.trim(),
		thinkingLevel: thinkingLevel as ThinkingLevel,
	};
}

export function readBranchSummaryModelSettings(path: string): BranchSummaryModelSettings | undefined {
	try {
		return parseBranchSummaryModelSettings(JSON.parse(readFileSync(path, "utf8")));
	} catch {
		return undefined;
	}
}
