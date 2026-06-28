import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import {
	discoverInstructionFiles,
	extractPathCandidates,
	formatProjectContext,
	normalizeExistingPath,
	resolveStartDirectory,
	type LoadedInstructionFile,
} from "./context.ts";

function contextFilePathsFromOptions(options: unknown): Set<string> {
	const contextFiles = (options as { contextFiles?: Array<{ path?: unknown }> } | undefined)?.contextFiles;
	if (!Array.isArray(contextFiles)) return new Set();

	return new Set(
		contextFiles
			.map((file) => (typeof file.path === "string" ? normalizeExistingPath(file.path) : null))
			.filter((path): path is string => Boolean(path)),
	);
}

export default function nestedAgentsContext(pi: ExtensionAPI) {
	let baseContextPaths = new Set<string>();
	let loadedInstructionPaths = new Set<string>();
	let loadedInstructionFiles: LoadedInstructionFile[] = [];

	function reset() {
		baseContextPaths = new Set();
		loadedInstructionPaths = new Set();
		loadedInstructionFiles = [];
	}

	function loadInstructionFile(path: string): string | null {
		try {
			return readFileSync(path, "utf8");
		} catch (error) {
			if (process.env.PI_NESTED_AGENTS_CONTEXT_DEBUG) {
				console.error(
					`[nested-agents-context] could not read ${path}: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
			return null;
		}
	}

	pi.on("session_start", async () => reset());
	pi.on("session_tree", async () => reset());
	pi.on("session_before_compact", async () => reset());
	pi.on("session_compact", async () => reset());
	pi.on("session_shutdown", async () => reset());

	pi.on("tool_execution_start", async (event, ctx) => {
		const candidates = extractPathCandidates(event.toolName, event.args);
		for (const candidate of candidates) {
			const startDir = resolveStartDirectory(candidate, ctx.cwd);
			if (!startDir) continue;

			for (const instructionFile of discoverInstructionFiles(startDir, ctx.cwd)) {
				if (baseContextPaths.has(instructionFile.realPath)) continue;
				if (loadedInstructionPaths.has(instructionFile.realPath)) continue;

				const content = loadInstructionFile(instructionFile.path);
				if (content === null) continue;

				loadedInstructionPaths.add(instructionFile.realPath);
				loadedInstructionFiles.push({ path: instructionFile.path, content });
			}
		}
	});

	pi.on("before_agent_start", async (event) => {
		baseContextPaths = contextFilePathsFromOptions(event.systemPromptOptions);
		const nestedFiles = loadedInstructionFiles.filter((file) => !baseContextPaths.has(normalizeExistingPath(file.path)));
		const nestedContext = formatProjectContext(nestedFiles);
		if (!nestedContext) return;
		return { systemPrompt: event.systemPrompt + nestedContext };
	});
}
