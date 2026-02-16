import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
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
} from "./helpers";

const DEFAULT_TIMEOUT_MS = 180_000;
const MAX_TIMEOUT_MS = 600_000;

const AuthParams = Type.Object({
	target: Type.String({
		description: "Server name or MCP URL to authenticate (for example: linear, vercel, https://mcp.linear.app/mcp)",
	}),
	timeoutMs: Type.Optional(
		Type.Number({
			description: `Auth timeout in milliseconds (default: ${DEFAULT_TIMEOUT_MS})`,
			minimum: 1_000,
			maximum: MAX_TIMEOUT_MS,
		}),
	),
});

interface AuthArgs {
	target: string;
	timeoutMs?: number;
}

interface AuthDetails {
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

function isValidTarget(value: string): boolean {
	if (value.length === 0 || /\s/.test(value)) return false;
	if (isLikelyUrl(value)) return isValidUrl(value);
	return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value);
}

export function registerMcporterAuthTool(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "mcporter_auth",
		label: "MCPorter Auth",
		description:
			"Run OAuth/authentication for an MCP server through MCPorter. Use when a server call fails due to missing login.",
		parameters: AuthParams,

		async execute(_toolCallId, params, signal) {
			const { target, timeoutMs } = params as AuthArgs;
			const cleanTarget = stripAtPrefix(target.trim());
			const effectiveTimeout = clampTimeout(timeoutMs, { value: DEFAULT_TIMEOUT_MS, max: MAX_TIMEOUT_MS });

			const details: AuthDetails = {
				command: "npx",
				args: ["-y", "mcporter", "auth"],
				exitCode: 1,
				timeoutMs: effectiveTimeout,
			};

			if (!isValidTarget(cleanTarget)) {
				details.error = "Invalid auth target";
				return {
					content: [{ type: "text" as const, text: "Invalid target. Use a configured server name or https:// MCP URL with no spaces." }],
					details,
					isError: true,
				};
			}

			const args = ["auth", "--json", cleanTarget];
			details.args = ["-y", "mcporter", ...args];

			try {
				const result = await pi.exec("npx", ["-y", "mcporter", ...args], {
					timeout: effectiveTimeout,
					signal,
				});

				details.exitCode = result.code;
				details.killed = result.killed;
				const combined = formatCombinedOutput(result.stdout, result.stderr);
				const finalized = finalizeOutput(combined, "pi-mcporter-auth-");
				details.truncated = finalized.truncated;
				details.fullOutputPath = finalized.fullOutputPath;

				const isError = result.code !== 0 || result.killed === true;
				if (isError) {
					details.error = result.killed ? "mcporter auth was terminated" : "mcporter auth failed";
					if (result.killed) details.errorType = signal?.aborted ? "aborted" : "timeout";
				}

				return {
					content: [{ type: "text" as const, text: finalized.text }],
					details,
					isError,
				};
			} catch (error) {
				const classified = classifyExecError(error, signal, {
					cancelled: "Auth command cancelled.",
					timeout: "Auth command timed out.",
					failedPrefix: "Failed to run MCPorter auth",
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
			const target = typeof args.target === "string" ? args.target : "?";
			let text = theme.fg("toolTitle", theme.bold("mcporter_auth "));
			text += theme.fg("muted", target);
			return new Text(text, 0, 0);
		},

		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Running MCP OAuth..."), 0, 0);
			const details = result.details as AuthDetails | undefined;
			if (!details) return new Text("Done", 0, 0);
			let text = details.exitCode === 0 ? theme.fg("success", "✓ auth complete") : theme.fg("error", "✗ auth failed");
			if (details.truncated) text += theme.fg("warning", " [truncated]");
			return new Text(text, 0, 0);
		},
	});
}
