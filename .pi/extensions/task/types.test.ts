import { describe, expect, it } from "vitest";
import { getBuiltInToolsFromActiveTools } from "./types.js";

describe("getBuiltInToolsFromActiveTools", () => {
	it("returns only supported built-in tools", () => {
		const input = [
			"read",
			"bash",
			"custom",
			"lsp",
			"edit",
			"find",
			"ls",
			"task",
		];
		expect(getBuiltInToolsFromActiveTools(input)).toEqual([
			"read",
			"bash",
			"edit",
			"find",
			"ls",
		]);
	});

	it("returns an empty array when no recognized tools are active", () => {
		expect(getBuiltInToolsFromActiveTools(["foo", "bar"])).toEqual([]);
	});
});
