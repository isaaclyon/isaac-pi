import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { ExtensionAPI, InputEvent, InputEventResult, ToolCallEvent, ToolCallEventResult } from "@earendil-works/pi-coding-agent";

const ALLOWED_TOOLS = new Set(["read", "edit", "write", "bash"]);
const ROOT_ENV = "PRODUCTIONIZE_AUTO_ROOT";
const SHELL_WRAPPERS = new Set(["npx", "bunx", "uvx"]);
const DOUBLE_TOKEN_WRAPPERS = new Set(["uv", "poetry", "pipenv", "pdm", "pixi", "rye", "hatch", "npm", "pnpm", "yarn"]);

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
			case "bash": {
				const command = await validateFocusedAutofixCommand(rootDir, String(event.input.command ?? ""));
				event.input.command = `cd ${shellQuote(await fs.realpath(rootDir))} && ${command}`;
				return undefined;
			}
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

export async function validateFocusedAutofixCommand(rootDir: string, input: string): Promise<string> {
	const command = input.trim();
	if (!command) throw new GuardError("Only focused local autofix commands are allowed in productionize auto repair.");
	if (/[\n\r`<>()]/.test(command) || command.includes("$") || command.includes(";") || command.includes("|") || hasSingleAmpersand(command)) {
		throw new GuardError("Only focused local autofix commands are allowed in productionize auto repair.");
	}
	const segments = command.split(/\s*&&\s*/).map((segment) => segment.trim()).filter(Boolean);
	if (segments.length === 0) throw new GuardError("Only focused local autofix commands are allowed in productionize auto repair.");
	for (const segment of segments) {
		if (!(await isAllowedAutofixSegment(rootDir, segment))) {
			throw new GuardError("Only focused local autofix commands are allowed in productionize auto repair.");
		}
	}
	return segments.join(" && ");
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

async function isAllowedAutofixSegment(rootDir: string, segment: string): Promise<boolean> {
	const tokens = shellTokens(segment);
	const command = unwrapCommand(tokens);
	if (command.length === 0) return false;

	const [tool, subcommand, ...rest] = command;
	if (tool === "ruff" && (subcommand === "format" || subcommand === "check")) {
		return await validateArgs(rootDir, rest, {
			requiredFlags: subcommand === "check" ? ["--fix"] : [],
			allowedFlags: new Set(["--fix", "--unsafe-fixes", "--preview", "--diff", "--force-exclude", "--respect-gitignore", "--no-cache", "--isolated"]),
		});
	}
	if (tool === "eslint") {
		return await validateArgs(rootDir, [subcommand, ...rest].filter(Boolean), {
			requiredFlags: ["--fix"],
			allowedFlags: new Set(["--fix", "--cache", "--no-cache", "--quiet"]),
		});
	}
	if (tool === "prettier") {
		return await validateArgs(rootDir, [subcommand, ...rest].filter(Boolean), {
			requiredFlags: ["--write"],
			allowedFlags: new Set(["--write", "--ignore-unknown", "--no-error-on-unmatched-pattern"]),
		});
	}
	if (tool === "biome" && (subcommand === "format" || subcommand === "check")) {
		return await validateArgs(rootDir, rest, {
			requiredFlags: subcommand === "check" ? ["--write"] : [],
			allowedFlags: new Set(["--write", "--unsafe"]),
		});
	}
	if (tool === "black" || tool === "isort" || tool === "swiftformat" || tool === "stylua") {
		return await validateArgs(rootDir, [subcommand, ...rest].filter(Boolean), { allowedFlags: new Set() });
	}
	if (tool === "autopep8" || tool === "yapf") {
		const args = [subcommand, ...rest].filter(Boolean);
		return (args.includes("-i") || args.includes("--in-place"))
			&& await validateArgs(rootDir, args, { allowedFlags: new Set(["-i", "--in-place"]) });
	}
	if (tool === "shfmt" || tool === "gofmt") {
		return await validateArgs(rootDir, [subcommand, ...rest].filter(Boolean), {
			requiredFlags: ["-w"],
			allowedFlags: new Set(["-w"]),
		});
	}
	if (tool === "go" && subcommand === "fmt") {
		return await validateArgs(rootDir, rest, { allowedFlags: new Set() });
	}
	if (tool === "cargo" && (subcommand === "fmt" || subcommand === "clippy")) {
		return await validateArgs(rootDir, rest, {
			requiredFlags: subcommand === "clippy" ? ["--fix"] : [],
			allowedFlags: new Set(["--fix", "--all", "--workspace", "--all-targets", "--all-features", "--allow-dirty", "--allow-staged"]),
		});
	}
	if (tool === "terraform" && subcommand === "fmt") {
		return await validateArgs(rootDir, rest, { allowedFlags: new Set(["-recursive", "-write=true"]) });
	}
	return false;
}

async function validateArgs(
	rootDir: string,
	args: string[],
	options: { requiredFlags?: string[]; allowedFlags: Set<string> },
): Promise<boolean> {
	const requiredFlags = new Set(options.requiredFlags ?? []);
	let sawSeparator = false;
	for (const arg of args) {
		if (!arg) continue;
		if (arg === "--") {
			sawSeparator = true;
			continue;
		}
		if (!sawSeparator && arg.startsWith("-")) {
			if (!options.allowedFlags.has(arg)) return false;
			requiredFlags.delete(arg);
			continue;
		}
		if (!(await isConfinedCommandPath(rootDir, arg))) return false;
	}
	return requiredFlags.size === 0;
}

async function isConfinedCommandPath(rootDir: string, candidate: string): Promise<boolean> {
	if (!candidate || /[*?\[\]{}~]/.test(candidate)) return false;
	const normalizedCandidate = candidate.endsWith("/...") ? candidate.slice(0, -4) || "." : candidate;
	if (normalizedCandidate === "...") return false;
	if (path.isAbsolute(normalizedCandidate)) return false;
	try {
		const canonicalRoot = await fs.realpath(rootDir);
		const absoluteCandidate = path.resolve(canonicalRoot, normalizedCandidate);
		const canonicalTarget = await resolveWriteTarget(absoluteCandidate);
		assertInsideRoot(canonicalRoot, canonicalTarget);
		assertNotGitMetadata(canonicalRoot, canonicalTarget);
		return true;
	} catch {
		return false;
	}
}

function hasSingleAmpersand(command: string): boolean {
	return command.replace(/&&/g, "").includes("&");
}

function unwrapCommand(tokens: string[]): string[] {
	let current = [...tokens];
	while (current.length > 0) {
		const [first, second] = current;
		if (SHELL_WRAPPERS.has(first ?? "")) {
			current = current.slice(1);
			continue;
		}
		if (DOUBLE_TOKEN_WRAPPERS.has(first ?? "") && second === "run") {
			current = current.slice(2);
			continue;
		}
		if (/^python(?:\d+(?:\.\d+)*)?$/.test(first ?? "") && second === "-m") {
			current = current.slice(2);
			continue;
		}
		if (first === "npm" && second === "exec") {
			current = current.slice(2);
			continue;
		}
		if (first === "pnpm" && second === "exec") {
			current = current.slice(2);
			continue;
		}
		if (first === "yarn" && second === "exec") {
			current = current.slice(2);
			continue;
		}
		break;
	}
	return current;
}

function shellTokens(command: string): string[] {
	return Array.from(command.matchAll(/"[^"]*"|'[^']*'|\S+/g), (match) => stripQuotes(match[0] ?? ""));
}

function stripQuotes(token: string): string {
	if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
		return token.slice(1, -1);
	}
	return token;
}

function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export default function productionizeRepairGuard(pi: ExtensionAPI): void {
	const configuredRoot = process.env[ROOT_ENV];
	if (!configuredRoot) {
		throw new Error(`${ROOT_ENV} is required for the productionize repair guard.`);
	}

	pi.on("input", (event) => guardInput(event));
	pi.on("tool_call", (event) => guardToolCall(event, configuredRoot));
}
