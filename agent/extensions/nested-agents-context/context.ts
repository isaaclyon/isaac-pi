import { existsSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export interface InstructionFileRef {
	path: string;
	realPath: string;
}

export interface LoadedInstructionFile {
	path: string;
	content: string;
}

const INSTRUCTION_FILENAMES = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"] as const;

const BUILTIN_PATH_KEYS_BY_TOOL = new Map<string, readonly string[]>([
	["read", ["path"]],
	["write", ["path"]],
	["edit", ["path"]],
	["ls", ["path"]],
	["list", ["path"]],
	["grep", ["path"]],
	["search", ["path"]],
	["find", ["path"]],
]);

const GENERIC_PATH_KEYS = new Set([
	"path",
	"paths",
	"filepath",
	"filepaths",
	"dir",
	"dirs",
	"directory",
	"directories",
	"root",
	"targetpath",
	"sourcepath",
	"destinationpath",
]);

const IGNORED_KEYS = new Set(["pattern", "glob", "content"]);

export function expandHome(path: string): string {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	return path;
}

export function normalizeCandidatePath(candidate: string, cwd: string): string | null {
	if (typeof candidate !== "string") return null;
	const trimmed = candidate.trim();
	if (!trimmed) return null;

	const withoutMention = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
	const expanded = expandHome(withoutMention);
	const absolute = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);

	try {
		return realpathSync.native(absolute);
	} catch {
		return absolute;
	}
}

export function normalizeExistingPath(path: string): string {
	try {
		return realpathSync.native(path);
	} catch {
		return resolve(path);
	}
}

export function isRelativePathInsideOrEqual(
	pathFromBoundary: string,
	isPathAbsolute: (path: string) => boolean = isAbsolute,
): boolean {
	return pathFromBoundary === "" || (!pathFromBoundary.startsWith("..") && !isPathAbsolute(pathFromBoundary));
}

export function isPathInsideOrEqual(path: string, boundary: string): boolean {
	const normalizedPath = normalizeExistingPath(path);
	const normalizedBoundary = normalizeExistingPath(boundary);
	return isRelativePathInsideOrEqual(relative(normalizedBoundary, normalizedPath));
}

export function resolveStartDirectory(candidate: string, cwd: string): string | null {
	const normalized = normalizeCandidatePath(candidate, cwd);
	if (!normalized) return null;

	try {
		const stat = statSync(normalized);
		return stat.isDirectory() ? normalizeExistingPath(normalized) : normalizeExistingPath(dirname(normalized));
	} catch {
		let current = dirname(normalized);
		while (true) {
			try {
				const stat = statSync(current);
				return stat.isDirectory() ? normalizeExistingPath(current) : null;
			} catch {
				const parent = dirname(current);
				if (parent === current) return null;
				current = parent;
			}
		}
	}
}

function collectStringValues(value: unknown): string[] {
	if (typeof value === "string") return [value];
	if (!Array.isArray(value)) return [];
	return value.filter((item): item is string => typeof item === "string");
}

function readObjectField(args: Record<string, unknown>, key: string): string[] {
	return collectStringValues(args[key]);
}

function genericPathCandidates(value: unknown): string[] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];

	const candidates: string[] = [];
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		const normalizedKey = key.toLowerCase();
		if (IGNORED_KEYS.has(normalizedKey)) continue;

		if (GENERIC_PATH_KEYS.has(normalizedKey)) {
			candidates.push(...collectStringValues(child));
			continue;
		}

		if (child && typeof child === "object" && !Array.isArray(child)) {
			candidates.push(...genericPathCandidates(child));
		}
	}
	return candidates;
}

export function extractPathCandidates(toolName: string, args: unknown): string[] {
	if (!args || typeof args !== "object" || Array.isArray(args)) return [];
	if (toolName === "bash") return [];

	const objectArgs = args as Record<string, unknown>;
	const candidates: string[] = [];
	const explicitKeys = BUILTIN_PATH_KEYS_BY_TOOL.get(toolName);

	if (explicitKeys) {
		for (const key of explicitKeys) {
			candidates.push(...readObjectField(objectArgs, key));
		}
	} else {
		candidates.push(...genericPathCandidates(objectArgs));
	}

	return [...new Set(candidates.filter((candidate) => candidate.trim().length > 0))];
}

function instructionFileInDir(dir: string): InstructionFileRef | null {
	for (const filename of INSTRUCTION_FILENAMES) {
		const path = join(dir, filename);
		if (!existsSync(path)) continue;
		const realPath = normalizeExistingPath(path);
		return { path, realPath };
	}
	return null;
}

export function discoverInstructionFiles(startDir: string, cwd: string): InstructionFileRef[] {
	const realCwd = normalizeExistingPath(cwd);
	const realStartDir = normalizeExistingPath(startDir);
	if (!isPathInsideOrEqual(realStartDir, realCwd)) return [];

	const deepestFirst: InstructionFileRef[] = [];
	let current = realStartDir;
	while (true) {
		const instructionFile = instructionFileInDir(current);
		if (instructionFile) deepestFirst.push(instructionFile);
		if (current === realCwd) break;
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}

	const seen = new Set<string>();
	const shallowToDeep: InstructionFileRef[] = [];
	for (const file of deepestFirst.reverse()) {
		if (seen.has(file.realPath)) continue;
		seen.add(file.realPath);
		shallowToDeep.push(file);
	}
	return shallowToDeep;
}

export function formatProjectContext(files: readonly LoadedInstructionFile[]): string {
	if (files.length === 0) return "";

	let prompt = "\n\n<project_context>\n\n";
	prompt += "Project-specific instructions and guidelines discovered from typed filesystem tool access:\n\n";
	for (const { path, content } of files) {
		prompt += `<project_instructions path="${path}">\n${content}\n</project_instructions>\n\n`;
	}
	prompt += "</project_context>\n";
	return prompt;
}
