import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type LcmConfig = {
	enabled: boolean;
	dbPath: string;
	freshTailCount: number;
	contextThreshold: number;
	leafChunkTokens: number;
	incrementalMaxDepth: number;
};

const DEFAULTS: LcmConfig = {
	enabled: false,
	dbPath: join(homedir(), ".pi", "agent", "lcm", "lcm.sqlite"),
	freshTailCount: 32,
	contextThreshold: 0.75,
	leafChunkTokens: 20_000,
	incrementalMaxDepth: 1,
};

function parseBoolean(value: string | undefined): boolean | undefined {
	if (!value) {
		return undefined;
	}
	const normalized = value.trim().toLowerCase();
	if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
		return true;
	}
	if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
		return false;
	}
	return undefined;
}

function parseNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) {
		return value;
	}
	if (typeof value !== "string") {
		return undefined;
	}
	const parsed = Number(value.trim());
	if (!Number.isFinite(parsed)) {
		return undefined;
	}
	return parsed;
}

function readProjectConfig(cwd: string): Partial<LcmConfig> {
	const filePath = join(cwd, ".pi", "lcm.json");
	if (!existsSync(filePath)) {
		return {};
	}
	try {
		const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<LcmConfig>;
		return parsed && typeof parsed === "object" ? parsed : {};
	} catch {
		return {};
	}
}

function clampConfig(input: Partial<LcmConfig>): Partial<LcmConfig> {
	const out: Partial<LcmConfig> = {};
	if (typeof input.enabled === "boolean") {
		out.enabled = input.enabled;
	}
	if (typeof input.dbPath === "string" && input.dbPath.trim()) {
		out.dbPath = input.dbPath.trim();
	}
	const freshTailCount = parseNumber(input.freshTailCount);
	if (freshTailCount !== undefined) {
		out.freshTailCount = Math.max(1, Math.floor(freshTailCount));
	}
	const contextThreshold = parseNumber(input.contextThreshold);
	if (contextThreshold !== undefined) {
		out.contextThreshold = Math.min(1, Math.max(0.1, contextThreshold));
	}
	const leafChunkTokens = parseNumber(input.leafChunkTokens);
	if (leafChunkTokens !== undefined) {
		out.leafChunkTokens = Math.max(1_000, Math.floor(leafChunkTokens));
	}
	const incrementalMaxDepth = parseNumber(input.incrementalMaxDepth);
	if (incrementalMaxDepth !== undefined) {
		out.incrementalMaxDepth = Math.max(0, Math.floor(incrementalMaxDepth));
	}
	return out;
}

export function resolveLcmConfig(cwd: string): LcmConfig {
	const projectConfig = clampConfig(readProjectConfig(cwd));

	const envEnabled = parseBoolean(process.env.PI_LCM_ENABLED);
	const envDbPath = process.env.PI_LCM_DB_PATH?.trim() || undefined;
	const envFreshTailCount = parseNumber(process.env.PI_LCM_FRESH_TAIL_COUNT);
	const envContextThreshold = parseNumber(process.env.PI_LCM_CONTEXT_THRESHOLD);
	const envLeafChunkTokens = parseNumber(process.env.PI_LCM_LEAF_CHUNK_TOKENS);
	const envIncrementalMaxDepth = parseNumber(process.env.PI_LCM_INCREMENTAL_MAX_DEPTH);

	const merged = {
		...DEFAULTS,
		...projectConfig,
		...(envEnabled !== undefined ? { enabled: envEnabled } : {}),
		...(envDbPath ? { dbPath: envDbPath } : {}),
		...(envFreshTailCount !== undefined ? { freshTailCount: envFreshTailCount } : {}),
		...(envContextThreshold !== undefined ? { contextThreshold: envContextThreshold } : {}),
		...(envLeafChunkTokens !== undefined ? { leafChunkTokens: envLeafChunkTokens } : {}),
		...(envIncrementalMaxDepth !== undefined ? { incrementalMaxDepth: envIncrementalMaxDepth } : {}),
	};

	return {
		enabled: merged.enabled,
		dbPath: merged.dbPath,
		freshTailCount: Math.max(1, Math.floor(merged.freshTailCount)),
		contextThreshold: Math.min(1, Math.max(0.1, merged.contextThreshold)),
		leafChunkTokens: Math.max(1_000, Math.floor(merged.leafChunkTokens)),
		incrementalMaxDepth: Math.max(0, Math.floor(merged.incrementalMaxDepth)),
	};
}
