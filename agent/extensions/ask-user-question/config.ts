import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface GuidanceFields {
	promptSnippet?: string;
	promptGuidelines?: string[];
}

export interface TimeoutFields {
	initialQuestionSeconds: number;
	questionSeconds: number;
}

export interface AskUserQuestionConfig {
	guidance?: GuidanceFields;
	timeout?: TimeoutFields;
}

export function validateGuidanceFields(fields: unknown): GuidanceFields {
	if (!fields || typeof fields !== "object") return {};
	const guidance = fields as Record<string, unknown>;
	const result: GuidanceFields = {};
	if (typeof guidance.promptSnippet === "string" && guidance.promptSnippet.length > 0) {
		result.promptSnippet = guidance.promptSnippet;
	}
	if (
		Array.isArray(guidance.promptGuidelines) &&
		guidance.promptGuidelines.length > 0 &&
		guidance.promptGuidelines.every((entry) => typeof entry === "string" && entry.length > 0)
	) {
		result.promptGuidelines = guidance.promptGuidelines;
	}
	return result;
}

function validatePositiveInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return undefined;
	return value;
}

export function validateTimeoutFields(fields: unknown): TimeoutFields | undefined {
	if (!fields || typeof fields !== "object") return undefined;
	const timeout = fields as Record<string, unknown>;
	const initialQuestionSeconds = validatePositiveInteger(timeout.initialQuestionSeconds);
	const questionSeconds = validatePositiveInteger(timeout.questionSeconds);
	if (initialQuestionSeconds === undefined || questionSeconds === undefined) return undefined;
	return { initialQuestionSeconds, questionSeconds };
}

export function defaultConfigPath(): string {
	return join(dirname(fileURLToPath(import.meta.url)), "config.json");
}

export function loadConfig(configPath = defaultConfigPath()): AskUserQuestionConfig {
	try {
		const raw = JSON.parse(readFileSync(configPath, "utf-8")) as unknown;
		if (!raw || typeof raw !== "object") return {};
		const parsed = raw as Record<string, unknown>;
		const guidance = validateGuidanceFields(parsed.guidance);
		const timeout = validateTimeoutFields(parsed.timeout);
		return {
			...(Object.keys(guidance).length > 0 ? { guidance } : {}),
			...(timeout ? { timeout } : {}),
		};
	} catch {
		return {};
	}
}
