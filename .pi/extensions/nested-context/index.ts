import type { ExtensionAPI, ExtensionContext, ToolCallEvent } from "@mariozechner/pi-coding-agent";
import { isToolCallEventType } from "@mariozechner/pi-coding-agent";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

type FileSelectionMode = "agents-first-fallback-claude" | "agents-only" | "claude-only" | "both";
type InstructionKind = "AGENTS.md" | "CLAUDE.md";

interface NestedContextConfig {
	enabled: boolean;
	fileSelectionMode: FileSelectionMode;
	strictFirstHit: boolean;
	maxChars: number;
	notifyOnLoad: boolean;
	refreshOnChange: boolean;
	includeCwdLevelFile: boolean;
}

interface PartialNestedContextConfig {
	enabled?: boolean;
	fileSelectionMode?: FileSelectionMode;
	strictFirstHit?: boolean;
	maxChars?: number;
	notifyOnLoad?: boolean;
	refreshOnChange?: boolean;
	includeCwdLevelFile?: boolean;
}

interface InstructionCandidate {
	path: string;
	kind: InstructionKind;
	mtimeMs: number;
}

interface LoadedInstruction extends InstructionCandidate {
	content: string;
	depthFromCwd: number;
}

interface State {
	config: NestedContextConfig;
	loadedByPath: Map<string, LoadedInstruction>;
}

const CONFIG_RELATIVE_PATH = ".pi/nested-context.json";
const DEFAULT_CONFIG: NestedContextConfig = {
	enabled: true,
	fileSelectionMode: "agents-first-fallback-claude",
	strictFirstHit: true,
	maxChars: 12000,
	notifyOnLoad: true,
	refreshOnChange: true,
	includeCwdLevelFile: false,
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function normalizeConfig(raw: PartialNestedContextConfig | undefined): NestedContextConfig {
	if (!raw) return DEFAULT_CONFIG;

	const selectionModes: FileSelectionMode[] = ["agents-first-fallback-claude", "agents-only", "claude-only", "both"];
	const fileSelectionMode = selectionModes.includes(raw.fileSelectionMode ?? "agents-first-fallback-claude")
		? (raw.fileSelectionMode ?? "agents-first-fallback-claude")
		: DEFAULT_CONFIG.fileSelectionMode;

	const parsedMaxChars = typeof raw.maxChars === "number" && Number.isFinite(raw.maxChars)
		? Math.max(2000, Math.floor(raw.maxChars))
		: DEFAULT_CONFIG.maxChars;

	return {
		enabled: raw.enabled ?? DEFAULT_CONFIG.enabled,
		fileSelectionMode,
		strictFirstHit: raw.strictFirstHit ?? DEFAULT_CONFIG.strictFirstHit,
		maxChars: parsedMaxChars,
		notifyOnLoad: raw.notifyOnLoad ?? DEFAULT_CONFIG.notifyOnLoad,
		refreshOnChange: raw.refreshOnChange ?? DEFAULT_CONFIG.refreshOnChange,
		includeCwdLevelFile: raw.includeCwdLevelFile ?? DEFAULT_CONFIG.includeCwdLevelFile,
	};
}

async function loadConfig(cwd: string, ctx: ExtensionContext): Promise<NestedContextConfig> {
	const configPath = resolve(cwd, CONFIG_RELATIVE_PATH);
	if (!existsSync(configPath)) return DEFAULT_CONFIG;

	try {
		const raw = await readFile(configPath, "utf8");
		const parsed = JSON.parse(raw);
		if (!isObject(parsed)) return DEFAULT_CONFIG;
		return normalizeConfig(parsed as PartialNestedContextConfig);
	} catch {
		if (ctx.hasUI) {
			ctx.ui.notify(`nested-context: failed to parse ${CONFIG_RELATIVE_PATH}; using defaults`, "warning");
		}
		return DEFAULT_CONFIG;
	}
}

function normalizeToolPath(rawPath: string): string {
	const trimmed = rawPath.trim();
	if (trimmed.startsWith("@")) return trimmed.slice(1);
	return trimmed;
}

function resolveToolPath(cwd: string, rawPath: string): string {
	const normalizedPath = normalizeToolPath(rawPath);
	if (isAbsolute(normalizedPath)) return resolve(normalizedPath);
	return resolve(cwd, normalizedPath);
}

function isWithinRoot(root: string, targetPath: string): boolean {
	const rel = relative(root, targetPath);
	return rel === "" || rel === "." || (!rel.startsWith("..") && !isAbsolute(rel));
}

function depthFromCwd(cwd: string, filePath: string): number {
	const rel = relative(cwd, dirname(filePath));
	if (!rel || rel === ".") return 0;
	return rel.split(/[\\/]/g).filter(Boolean).length;
}

async function resolveTargetDirectory(targetPath: string): Promise<string> {
	try {
		const stats = await stat(targetPath);
		if (stats.isDirectory()) return targetPath;
	} catch {
		// Fall back to dirname for non-existent files or stat errors.
	}
	return dirname(targetPath);
}

async function readCandidate(path: string, kind: InstructionKind): Promise<InstructionCandidate | undefined> {
	try {
		const stats = await stat(path);
		if (!stats.isFile()) return undefined;
		return {
			path,
			kind,
			mtimeMs: stats.mtimeMs,
		};
	} catch {
		return undefined;
	}
}

async function discoverForDirectory(
	dirPath: string,
	mode: FileSelectionMode,
): Promise<InstructionCandidate[]> {
	const agentsPath = join(dirPath, "AGENTS.md");
	const claudePath = join(dirPath, "CLAUDE.md");

	if (mode === "agents-only") {
		const agents = await readCandidate(agentsPath, "AGENTS.md");
		return agents ? [agents] : [];
	}

	if (mode === "claude-only") {
		const claude = await readCandidate(claudePath, "CLAUDE.md");
		return claude ? [claude] : [];
	}

	if (mode === "both") {
		const [agents, claude] = await Promise.all([
			readCandidate(agentsPath, "AGENTS.md"),
			readCandidate(claudePath, "CLAUDE.md"),
		]);
		return [agents, claude].filter((value): value is InstructionCandidate => value !== undefined);
	}

	const agents = await readCandidate(agentsPath, "AGENTS.md");
	if (agents) return [agents];
	const claude = await readCandidate(claudePath, "CLAUDE.md");
	return claude ? [claude] : [];
}

async function discoverInstructionFiles(
	cwd: string,
	targetDirectory: string,
	mode: FileSelectionMode,
	includeCwdLevelFile: boolean,
): Promise<InstructionCandidate[]> {
	const discovered: InstructionCandidate[] = [];

	let current = targetDirectory;
	while (true) {
		const shouldScanCurrent = current !== cwd || includeCwdLevelFile;
		if (shouldScanCurrent) {
			discovered.push(...(await discoverForDirectory(current, mode)));
		}
		if (current === cwd) break;

		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return discovered;
}

async function loadDiscoveredFiles(
	cwd: string,
	state: State,
	candidates: InstructionCandidate[],
): Promise<LoadedInstruction[]> {
	const updated: LoadedInstruction[] = [];

	for (const candidate of candidates) {
		const existing = state.loadedByPath.get(candidate.path);
		if (existing) {
			if (!state.config.refreshOnChange) continue;
			if (existing.mtimeMs === candidate.mtimeMs) continue;
		}

		try {
			const content = (await readFile(candidate.path, "utf8")).trim();
			if (!content) continue;

			const loaded: LoadedInstruction = {
				...candidate,
				content,
				depthFromCwd: depthFromCwd(cwd, candidate.path),
			};
			state.loadedByPath.set(candidate.path, loaded);
			updated.push(loaded);
		} catch {
			// Ignore unreadable files.
		}
	}

	return updated;
}

function toPortablePath(path: string): string {
	return path.replaceAll("\\\\", "/");
}

function normalizeDirPath(path: string): string {
	return resolve(path);
}

function buildContextMessage(entries: LoadedInstruction[], maxChars: number): string | undefined {
	if (entries.length === 0) return undefined;

	const sorted = [...entries].sort((a, b) => {
		if (a.depthFromCwd !== b.depthFromCwd) return b.depthFromCwd - a.depthFromCwd;
		return a.path.localeCompare(b.path);
	});

	const header = [
		"Nested instruction files loaded during this session.",
		"Apply each file to its directory scope.",
		"Precedence: deeper (more specific) directory wins.",
		"",
	].join("\n");

	let output = header;
	let remaining = maxChars - output.length;
	if (remaining <= 0) return output.slice(0, maxChars);

	for (const entry of sorted) {
		const scopeDir = toPortablePath(dirname(entry.path));
		const sectionHeader = `---\nFile: ${toPortablePath(entry.path)}\nScope: ${scopeDir}/**\n---\n`;
		if (sectionHeader.length >= remaining) break;

		output += sectionHeader;
		remaining -= sectionHeader.length;

		if (entry.content.length <= remaining) {
			output += `${entry.content}\n\n`;
			remaining -= entry.content.length + 2;
			continue;
		}

		const budget = Math.max(0, remaining - 20);
		output += `${entry.content.slice(0, budget).trimEnd()}\n[TRUNCATED]`;
		remaining = 0;
		break;
	}

	return output;
}

function toolPathFromEvent(event: ToolCallEvent): string | undefined {
	if (isToolCallEventType("read", event)) return event.input.path;
	if (isToolCallEventType("edit", event)) return event.input.path;
	if (isToolCallEventType("write", event)) return event.input.path;
	return undefined;
}

function blockReason(newEntries: LoadedInstruction[]): string {
	const files = newEntries.map((entry) => `- ${toPortablePath(entry.path)}`).join("\n");
	return [
		"Loaded nested instruction file(s):",
		files,
		"",
		"Retry the same tool call now that these rules are in context.",
	].join("\n");
}

function clearLoadedState(state: State): void {
	state.loadedByPath.clear();
}


export const __test = {
	normalizeConfig,
	resolveToolPath,
	isWithinRoot,
	buildContextMessage,
	discoverForDirectory,
	discoverInstructionFiles,
	DEFAULT_CONFIG,
};

export default function nestedContext(pi: ExtensionAPI): void {
	const state: State = {
		config: DEFAULT_CONFIG,
		loadedByPath: new Map<string, LoadedInstruction>(),
	};

	pi.on("session_start", async (_event, ctx) => {
		state.config = await loadConfig(ctx.cwd, ctx);
		clearLoadedState(state);
	});

	pi.on("session_switch", async (_event, ctx) => {
		state.config = await loadConfig(ctx.cwd, ctx);
		clearLoadedState(state);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!state.config.enabled) return;

		const rawPath = toolPathFromEvent(event);
		if (!rawPath) return;

		const absoluteTargetPath = resolveToolPath(ctx.cwd, rawPath);
		if (!isWithinRoot(ctx.cwd, absoluteTargetPath)) return;

		const targetDirectory = await resolveTargetDirectory(absoluteTargetPath);
		if (!isWithinRoot(ctx.cwd, targetDirectory)) return;

		const candidates = await discoverInstructionFiles(
			ctx.cwd,
			targetDirectory,
			state.config.fileSelectionMode,
			state.config.includeCwdLevelFile,
		);
		if (candidates.length === 0) return;

		const newEntries = await loadDiscoveredFiles(ctx.cwd, state, candidates);
		if (newEntries.length === 0) return;

		if (state.config.notifyOnLoad && ctx.hasUI) {
			ctx.ui.notify(`nested-context: loaded ${newEntries.length} instruction file(s)`, "info");
		}

		if (state.config.strictFirstHit) {
			return { block: true, reason: blockReason(newEntries) };
		}
	});

	pi.on("context", async (event, ctx) => {
		if (!state.config.enabled || state.loadedByPath.size === 0) return;

		const allEntries = Array.from(state.loadedByPath.values());
		const cwdDir = normalizeDirPath(ctx.cwd);
		const entries = state.config.includeCwdLevelFile
			? allEntries
			: allEntries.filter((entry) => {
				if (entry.depthFromCwd <= 0) return false;
				return normalizeDirPath(dirname(entry.path)) !== cwdDir;
			});
		if (entries.length === 0) return;

		const messageText = buildContextMessage(entries, state.config.maxChars);
		if (!messageText) return;

		return {
			messages: [
				...event.messages,
				{
					role: "user" as const,
					content: [{ type: "text" as const, text: messageText }],
					timestamp: Date.now(),
				},
			],
		};
	});
}
