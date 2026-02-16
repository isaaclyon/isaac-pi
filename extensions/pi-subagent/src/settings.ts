/**
 * pi-subagent — Settings loader.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import type { SubagentSettings } from "./types.ts";

const SETTINGS_KEY = "pi-subagent";

const DEFAULT_BLOCKED = [
	"pi-webserver",
	"pi-cron",
	"pi-heartbeat",
	"pi-channels",
	"pi-web-dashboard",
	"pi-telemetry",
];

interface JsonObject {
	[key: string]: unknown;
}

function isRecord(value: unknown): value is JsonObject {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readJsonSafe(filePath: string): JsonObject {
	try {
		const parsed: unknown = JSON.parse(fs.readFileSync(filePath, "utf-8"));
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function getSettingsBlock(fileJson: JsonObject): JsonObject {
	const block = fileJson[SETTINGS_KEY];
	return isRecord(block) ? block : {};
}

function toNumber(value: unknown, fallback: number, min = 0): number {
	if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
	const n = Math.floor(value);
	return n < min ? fallback : n;
}

function toModel(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	const out = value
		.filter((item): item is string => typeof item === "string")
		.map((item) => item.trim())
		.filter((item) => item.length > 0);
	return [...new Set(out)];
}

export function resolveSettings(cwd: string): SubagentSettings {
	const globalPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
	const projectPath = path.join(cwd, ".pi", "settings.json");

	const globalRaw = getSettingsBlock(readJsonSafe(globalPath));
	const projectRaw = getSettingsBlock(readJsonSafe(projectPath));
	const merged: JsonObject = { ...globalRaw, ...projectRaw };

	const maxTotal = toNumber(merged.maxTotal, 8, 1);
	const requestedConcurrent = toNumber(merged.maxConcurrent, 4, 1);
	const maxConcurrent = Math.min(requestedConcurrent, maxTotal);

	// User/project settings can ADD to blocked extensions but never remove defaults.
	const userBlocked = toStringArray(merged.blockedExtensions);
	const blockedExtensions = [...new Set([...DEFAULT_BLOCKED, ...userBlocked])];

	return {
		maxConcurrent,
		maxTotal,
		timeoutMs: toNumber(merged.timeoutMs, 600_000, 0),
		model: toModel(merged.model),
		extensions: toStringArray(merged.extensions),
		blockedExtensions,
		maxPoolSize: toNumber(merged.maxPoolSize, 20, 1),
		maxDepth: toNumber(merged.maxDepth, 4, 0),
	};
}
