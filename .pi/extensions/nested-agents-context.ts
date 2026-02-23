import fs from "node:fs/promises";
import path from "node:path";
import {
	isToolCallEventType,
	type ExtensionAPI,
	type ToolCallEvent,
} from "@mariozechner/pi-coding-agent";

type AgentsState = {
	cwd: string;
	loadedAgents: Set<string>;
	pendingSystemContext: string[];
};

const state: AgentsState = {
	cwd: "",
	loadedAgents: new Set(),
	pendingSystemContext: [],
};

const AGENTS_FILE = "AGENTS.md";

function resetStateForSession(cwd: string): void {
	state.cwd = path.resolve(cwd);
	state.loadedAgents.clear();
	state.pendingSystemContext.length = 0;
}

function isPathWithinCwd(candidate: string, cwd: string): boolean {
	const relative = path.relative(cwd, candidate);
	if (relative === "") return true;
	if (relative.startsWith("..") || path.isAbsolute(relative)) return false;
	return true;
}

function formatAgentsSection(filePath: string, content: string): string {
	const trimmed = content.trimEnd();
	return `

## Loaded AGENTS.md (system instructions)
File: ${filePath}

${trimmed}
`;
}

function extractPathFromToolCall(event: ToolCallEvent): string | undefined {
	if (isToolCallEventType("read", event)) {
		return event.input.path;
	}
	if (isToolCallEventType("edit", event)) {
		return event.input.path;
	}
	if (isToolCallEventType("write", event)) {
		return event.input.path;
	}
	return undefined;
}

async function resolveStartDirectory(cwd: string, candidatePath: string): Promise<string> {
	const absolutePath = path.resolve(cwd, candidatePath);
	const parentDir = path.dirname(absolutePath);

	try {
		const stat = await fs.stat(absolutePath);
		return stat.isDirectory() ? absolutePath : parentDir;
	} catch {
		return parentDir;
	}
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
	try {
		const raw = await fs.readFile(filePath, "utf8");
		return raw;
	} catch {
		return undefined;
	}
}

async function collectNestedAgentContext(startDir: string): Promise<string[]> {
	const results: string[] = [];
	let current = path.resolve(startDir);

	while (isPathWithinCwd(current, state.cwd)) {
		if (current !== state.cwd) {
			const agentsPath = path.join(current, AGENTS_FILE);
			if (!state.loadedAgents.has(agentsPath)) {
				const contents = await readFileIfExists(agentsPath);
				if (contents !== undefined) {
					state.loadedAgents.add(agentsPath);
					results.push(formatAgentsSection(agentsPath, contents));
				}
			}
		}

		const parent = path.dirname(current);
		if (parent === current) break;
		current = parent;
	}

	return results;
}

export default function nestedAgentsContext(pi: ExtensionAPI): void {
	pi.on("session_start", async (_event, ctx) => {
		resetStateForSession(ctx.cwd);
	});

	pi.on("session_switch", async (_event, ctx) => {
		resetStateForSession(ctx.cwd);
	});

	pi.on("tool_call", async (event) => {
		const eventPath = extractPathFromToolCall(event);
		if (!eventPath) {
			return;
		}

		if (!state.cwd) {
			return;
		}

		const absolute = path.resolve(state.cwd, eventPath);
		if (!isPathWithinCwd(absolute, state.cwd)) {
			return;
		}

		const startDir = await resolveStartDirectory(state.cwd, eventPath);
		const newBlocks = await collectNestedAgentContext(startDir);
		if (newBlocks.length === 0) {
			return;
		}

		state.pendingSystemContext.push(...newBlocks);
	});

	pi.on("before_agent_start", (event) => {
		if (state.pendingSystemContext.length === 0) {
			return;
		}

		const blocks = state.pendingSystemContext.splice(0, state.pendingSystemContext.length).join("\n");
		return {
			systemPrompt: `${event.systemPrompt}\n${blocks}`,
		};
	});
}
