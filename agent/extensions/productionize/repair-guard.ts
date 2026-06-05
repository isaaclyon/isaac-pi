import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, InputEvent, InputEventResult, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

const ALLOWED_TOOLS = new Set(["read", "edit", "write"]);
const ROOT_ENV = "PRODUCTIONIZE_AUTO_ROOT";

export class GuardError extends Error {}

export async function guardInput(event: InputEvent): Promise<InputEventResult | undefined> {
	const text = event.text.trimStart();
	if (/^\/productionize(?:\b|\/)/i.test(text)) {
		return { action: "handled" };
	}
	return undefined;
}

export async function guardToolCall(event: ToolCallEvent, rootDir: string): Promise<ToolCallEventResult | undefined> {
	if (!ALLOWED_TOOLS.has(event.toolName)) {
		return { block: true, reason: `Tool ${event.toolName} is not allowed in productionize auto repair.` };
	}

	try {
		switch (event.toolName) {
			case "read":
			case "edit":
			case "write": {
				event.input.path = await resolveConfinedPath(rootDir, String(event.input.path), event.toolName === "write" ? "write" : "existing");
				return undefined;
			}
		}
	} catch (error) {
		return { block: true, reason: error instanceof Error ? error.message : String(error) };
	}

	return undefined;
}

export async function resolveConfinedPath(rootDir: string, candidatePath: string, mode: "existing" | "write"): Promise<string> {
	const canonicalRoot = await fs.realpath(rootDir);
	const absoluteCandidate = path.resolve(canonicalRoot, candidatePath);
	const canonicalTarget = mode === "write"
		? await resolveWriteTarget(absoluteCandidate)
		: await fs.realpath(absoluteCandidate);
	assertInsideRoot(canonicalRoot, canonicalTarget);
	assertNotGitMetadata(canonicalRoot, canonicalTarget);
	return canonicalTarget;
}

async function resolveWriteTarget(target: string): Promise<string> {
	try {
		return await fs.realpath(target);
	} catch {
		const parent = path.dirname(target);
		const basename = path.basename(target);
		if (!basename || basename === "." || basename === "..") {
			throw new GuardError(`Invalid write target: ${target}`);
		}
		const canonicalParent = await fs.realpath(parent);
		return path.join(canonicalParent, basename);
	}
}

function assertInsideRoot(rootDir: string, targetPath: string): void {
	const relative = path.relative(rootDir, targetPath);
	if (relative === "" || relative === ".") return;
	if (relative.startsWith("..") || path.isAbsolute(relative)) {
		throw new GuardError(`Path escapes the repair worktree: ${targetPath}`);
	}
}

function assertNotGitMetadata(rootDir: string, targetPath: string): void {
	const relative = path.relative(rootDir, targetPath);
	if (relative === ".git" || relative.startsWith(`.git${path.sep}`)) {
		throw new GuardError(`Editing ${relative} is not allowed during productionize auto repair.`);
	}
}

export default function productionizeRepairGuard(pi: ExtensionAPI): void {
	const configuredRoot = process.env[ROOT_ENV];
	if (!configuredRoot) {
		throw new Error(`${ROOT_ENV} is required for the productionize repair guard.`);
	}

	pi.on("input", (event) => guardInput(event));
	pi.on("tool_call", (event) => guardToolCall(event, configuredRoot));
}
