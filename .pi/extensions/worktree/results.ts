import type { ErrorCode, ToolError, ToolResult } from "./types";

export function makeToolError(message: string, code: ErrorCode): ToolError {
	return { ok: false, error: message, code };
}

export function isToolError(value: unknown): value is ToolError {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return candidate["ok"] === false && typeof candidate["error"] === "string" && typeof candidate["code"] === "string";
}

export function buildToolResult(details: Record<string, unknown>, displayText?: string): ToolResult {
	if (details["ok"] === false) {
		return {
			content: [{ type: "text", text: String(details["error"] ?? "worktree command failed") }],
			details,
			isError: true,
		};
	}
	return {
		content: [{ type: "text", text: displayText ?? JSON.stringify(details, null, 2) }],
		details,
	};
}
