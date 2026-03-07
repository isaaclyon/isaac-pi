import { describe, expect, it } from "vitest";

import { buildToolResult, isToolError, makeToolError } from "./results.js";

describe("worktree result helpers", () => {
	it("creates standard tool errors", () => {
		const err = makeToolError("bad", "INVALID_ARGUMENT");
		expect(err).toEqual({ ok: false, error: "bad", code: "INVALID_ARGUMENT" });
		expect(isToolError(err)).toBe(true);
	});

	it("detects invalid tool errors", () => {
		expect(isToolError({})).toBe(false);
		expect(isToolError({ ok: false, error: 1, code: "NO" })).toBe(false);
		expect(isToolError({ ok: false, error: "oops", code: 123 })).toBe(false);
	});

	it("builds error tool results", () => {
		const result = buildToolResult({ ok: false, error: "bad", code: "INVALID_ARGUMENT" });
		expect(result.content[0]?.text).toBe("bad");
		expect(result.isError).toBe(true);
		expect(result.details).toEqual({ ok: false, error: "bad", code: "INVALID_ARGUMENT" });
	});

	it("builds success tool results with pretty JSON", () => {
		const data = { ok: true, path: "/tmp", created: true };
		const result = buildToolResult(data, "created");
		expect(result.content[0]?.text).toBe("created");
		expect(result.isError).toBeUndefined();
		expect(result.details).toEqual(data);
	});
});
