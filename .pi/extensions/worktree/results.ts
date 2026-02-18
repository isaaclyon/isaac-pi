import type { ErrorCode, ToolError, ToolResult } from "./types";

export function makeToolError(message: string, code: ErrorCode): ToolError {
	return { ok: false, error: message, code };
}

export function isToolError(value: unknown): value is ToolError {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Record<string, unknown>;
	return candidate["ok"] === false && typeof candidate["error"] === "string" && typeof candidate["code"] === "string";
}

export function buildToolResult(details: object, displayText?: string): ToolResult {
	const record = details as Record<string, unknown>;
	if (record["ok"] === false) {
		return {
			content: [{ type: "text", text: String(record["error"] ?? "worktree command failed") }],
			details: record,
			isError: true,
		};
	}
	return {
		content: [{ type: "text", text: displayText ?? JSON.stringify(details, null, 2) }],
		details: record,
	};
}
