import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { formatSize } from "@mariozechner/pi-coding-agent";
import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import {
	clampTimeout,
	classifyExecError,
	finalizeOutput,
	formatCombinedOutput,
	isLikelyUrl,
	isValidUrl,
	stripAtPrefix,
	type ErrorType,
} from "./mcporter/helpers";
import { registerMcporterAuthTool } from "./mcporter/auth-tool";

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_CALL_ARG_TOKEN_BYTES = 200 * 1024;
const MAX_CALL_ARGS_TOTAL_BYTES = 500 * 1024;

const ListParams = Type.Object({
	target: Type.Optional(
		Type.String({
			description: "Optional server name or MCP URL to inspect (for example: linear, context7, https://mcp.linear.app/mcp)",
		}),
	),
	schema: Type.Optional(Type.Boolean({ description: "Show full schemas when supported (default: false)" })),
	allParameters: Type.Optional(Type.Boolean({ description: "Show all optional parameters (default: false)" })),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Command timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
			minimum: 1_000,
			maximum: MAX_TIMEOUT_MS,
		}),
	),
});

const CallParams = Type.Object({
	server: Type.String({
		description: "MCP server name or MCP URL base (for example: linear, chrome-devtools, https://mcp.linear.app/mcp)",
	}),
	tool: Type.String({
		description: "Tool name on the server (letters, numbers, _, -; for example: create_comment, list-issues)",
	}),
	args: Type.Optional(
		Type.Record(Type.String(), Type.Unknown(), {
			description: "Arguments object passed to the MCP tool",
		}),
	),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Command timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
			minimum: 1_000,
			maximum: MAX_TIMEOUT_MS,
		}),
	),
});

interface ListArgs {
	target?: string;
	schema?: boolean;
	allParameters?: boolean;
	timeoutMs?: number;
}

interface CallArgs {
	server: string;
	tool: string;
	args?: Record<string, unknown>;
	timeoutMs?: number;
}

interface McporterDetails {
	command: string;
	args: string[];
	exitCode: number;
	timeoutMs: number;
	killed?: boolean;
	errorType?: ErrorType;
	truncated?: boolean;
	fullOutputPath?: string;
	error?: string;
}

function isValidServerToken(value: string): boolean {
	if (value.length === 0 || /\s/.test(value)) return false;
	if (isLikelyUrl(value)) return isValidUrl(value);
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

function isValidToolToken(value: string): boolean {
	return /^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value);
}

function isValidArgKey(key: string): boolean {
	return /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(key);
}

function encodeArgValue(value: unknown): { ok: true; value: string } | { ok: false; message: string } {
	if (typeof value === "undefined") return { ok: true, value: "null" };
	if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
		return { ok: true, value: JSON.stringify(String(value)) };
	}
	try {
		const json = JSON.stringify(value);
		if (json === undefined) {
			return { ok: false, message: "Argument could not be serialized to JSON." };
		}
		return { ok: true, value: json };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { ok: false, message: `Argument serialization failed: ${message}` };
	}
}

function buildCallKeyValueArgs(args: Record<string, unknown> | undefined): { ok: true; tokens: string[] } | { ok: false; message: string } {
	const tokens: string[] = [];
	let totalBytes = 0;

	for (const [key, value] of Object.entries(args ?? {})) {
		if (!isValidArgKey(key)) {
			return {
				ok: false,
				message: `Invalid argument key '${key}'. Keys must match [A-Za-z_][A-Za-z0-9_.-]*.`,
			};
		}
		if (typeof value === "undefined") continue;

		const encoded = encodeArgValue(value);
		if (!encoded.ok) {
			return {
				ok: false,
				message: `Invalid argument value for '${key}': ${encoded.message}`,
			};
		}

		const token = `${key}=${encoded.value}`;
		const tokenBytes = Buffer.byteLength(token, "utf8");
		if (tokenBytes > MAX_CALL_ARG_TOKEN_BYTES) {
			return {
				ok: false,
				message: `Argument '${key}' is too large (${formatSize(tokenBytes)}). Limit is ${formatSize(MAX_CALL_ARG_TOKEN_BYTES)}.`,
			};
		}

		totalBytes += tokenBytes;
		if (totalBytes > MAX_CALL_ARGS_TOTAL_BYTES) {
			return {
				ok: false,
				message: `Combined arguments are too large (${formatSize(totalBytes)}). Limit is ${formatSize(MAX_CALL_ARGS_TOTAL_BYTES)}.`,
			};
		}

		tokens.push(token);
	}
	return { ok: true, tokens };
}

async function runMcporter(
	pi: ExtensionAPI,
	commandArgs: string[],
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string; code: number; killed?: boolean }> {
	return pi.exec("npx", ["-y", "mcporter", ...commandArgs], {
		timeout: timeoutMs,
		signal,
	});
}

export default function mcporter(pi: ExtensionAPI) {
	registerMcporterAuthTool(pi);

	pi.registerTool({
		name: "mcporter_list",
		label: "MCPorter List",
		description:
			"List MCP servers/tools using MCPorter. Good first step before calls. Runs npx -y mcporter list --json and returns structured output.",
		parameters: ListParams,

		async execute(_toolCallId, params, signal) {
			const { target, schema = false, allParameters = false, timeoutMs } = params as ListArgs;
			const effectiveTimeout = clampTimeout(timeoutMs, { value: DEFAULT_TIMEOUT_MS, max: MAX_TIMEOUT_MS });

			const args: string[] = ["list", "--json"];
			if (schema) args.push("--schema");
			if (allParameters) args.push("--all-parameters");

			const cleanTarget = target?.trim() ? stripAtPrefix(target.trim()) : undefined;
			if (cleanTarget && !isValidServerToken(cleanTarget)) {
				return {
					content: [{ type: "text" as const, text: "Invalid target. Use a configured server name or https:// MCP URL with no spaces." }],
					details: {
						command: "npx",
						args: ["-y", "mcporter", ...args],
						exitCode: 1,
						timeoutMs: effectiveTimeout,
						error: "Invalid list target",
					} satisfies McporterDetails,
					isError: true,
				};
			}
			if (cleanTarget) args.push(cleanTarget);

			const details: McporterDetails = {
				command: "npx",
				args: ["-y", "mcporter", ...args],
				exitCode: 1,
				timeoutMs: effectiveTimeout,
			};

			try {
				const result = await runMcporter(pi, args, effectiveTimeout, signal);
				details.exitCode = result.code;
				details.killed = result.killed;

				const combined = formatCombinedOutput(result.stdout, result.stderr);
				const finalized = finalizeOutput(combined, "pi-mcporter-");
				details.truncated = finalized.truncated;
				details.fullOutputPath = finalized.fullOutputPath;

				const isError = result.code !== 0 || result.killed === true;
				if (isError) {
					details.error = result.killed ? "mcporter list was terminated" : "mcporter list failed";
					if (result.killed) details.errorType = signal?.aborted ? "aborted" : "timeout";
				}

				return {
					content: [{ type: "text" as const, text: finalized.text }],
					details,
					isError,
				};
			} catch (error) {
				const classified = classifyExecError(error, signal, {
					cancelled: "Command cancelled.",
					timeout: "Command timed out.",
					failedPrefix: "Failed to run MCPorter",
				});
				details.error = classified.message;
				details.errorType = classified.errorType;
				details.exitCode = classified.exitCode;
				return {
					content: [{ type: "text" as const, text: classified.userMessage }],
					details,
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const target = typeof args.target === "string" ? args.target : "(all servers)";
			let text = theme.fg("toolTitle", theme.bold("mcporter_list "));
			text += theme.fg("muted", target);
			if (args.schema === true) text += theme.fg("dim", " [schema]");
			if (args.allParameters === true) text += theme.fg("dim", " [all-parameters]");
			return new Text(text, 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Listing MCP servers..."), 0, 0);
			const details = result.details as McporterDetails | undefined;
			if (!details) return new Text("Done", 0, 0);
			let text = details.exitCode === 0 ? theme.fg("success", "✓ list complete") : theme.fg("error", "✗ list failed");
			if (details.truncated) text += theme.fg("warning", " [truncated]");
			return new Text(text, 0, 0);
		},
	});

	pi.registerTool({
		name: "mcporter_call",
		label: "MCPorter Call",
		description:
			"Call a specific MCP tool through MCPorter. Runs npx -y mcporter call --output json and returns the tool response.",
		parameters: CallParams,

		async execute(_toolCallId, params, signal) {
			const { server, tool, args, timeoutMs } = params as CallArgs;
			const safeServer = stripAtPrefix(server.trim());
			const safeTool = stripAtPrefix(tool.trim());
			const effectiveTimeout = clampTimeout(timeoutMs, { value: DEFAULT_TIMEOUT_MS, max: MAX_TIMEOUT_MS });

			const details: McporterDetails = {
				command: "npx",
				args: ["-y", "mcporter", "call"],
				exitCode: 1,
				timeoutMs: effectiveTimeout,
			};

			if (!isValidServerToken(safeServer)) {
				details.error = "Invalid server token";
				return {
					content: [{ type: "text" as const, text: "Invalid server. Use a configured server name or https:// MCP URL with no spaces." }],
					details,
					isError: true,
				};
			}
			if (!isValidToolToken(safeTool)) {
				details.error = "Invalid tool token";
				return {
					content: [{ type: "text" as const, text: "Invalid tool name. Allowed characters: letters, numbers, '_' and '-'." }],
					details,
					isError: true,
				};
			}

			const encodedArgs = buildCallKeyValueArgs(args);
			if (!encodedArgs.ok) {
				details.error = encodedArgs.message;
				return {
					content: [{ type: "text" as const, text: encodedArgs.message }],
					details,
					isError: true,
				};
			}

			const commandArgs = ["call", "--output", "json", safeServer, "--tool", safeTool, ...encodedArgs.tokens];
			details.args = ["-y", "mcporter", ...commandArgs];

			try {
				const result = await runMcporter(pi, commandArgs, effectiveTimeout, signal);
				details.exitCode = result.code;
				details.killed = result.killed;

				const combined = formatCombinedOutput(result.stdout, result.stderr);
				const finalized = finalizeOutput(combined, "pi-mcporter-");
				details.truncated = finalized.truncated;
				details.fullOutputPath = finalized.fullOutputPath;

				const isError = result.code !== 0 || result.killed === true;
				if (isError) {
					details.error = result.killed ? "mcporter call was terminated" : "mcporter call failed";
					if (result.killed) details.errorType = signal?.aborted ? "aborted" : "timeout";
				}

				return {
					content: [{ type: "text" as const, text: finalized.text }],
					details,
					isError,
				};
			} catch (error) {
				const classified = classifyExecError(error, signal, {
					cancelled: "Command cancelled.",
					timeout: "Command timed out.",
					failedPrefix: "Failed to run MCPorter",
				});
				details.error = classified.message;
				details.errorType = classified.errorType;
				details.exitCode = classified.exitCode;
				return {
					content: [{ type: "text" as const, text: classified.userMessage }],
					details,
					isError: true,
				};
			}
		},

		renderCall(args, theme) {
			const server = typeof args.server === "string" ? args.server : "?";
			const tool = typeof args.tool === "string" ? args.tool : "?";
			let text = theme.fg("toolTitle", theme.bold("mcporter_call "));
			text += theme.fg("muted", `${server}.${tool}`);
			return new Text(text, 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Calling MCP tool..."), 0, 0);
			const details = result.details as McporterDetails | undefined;
			if (!details) return new Text("Done", 0, 0);
			let text = details.exitCode === 0 ? theme.fg("success", "✓ call complete") : theme.fg("error", "✗ call failed");
			if (details.truncated) text += theme.fg("warning", " [truncated]");
			return new Text(text, 0, 0);
		},
	});
}
