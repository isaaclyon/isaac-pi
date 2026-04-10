import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import mempalaceExtension from "./index.js";
import { createMempalaceOperations } from "./operations.js";
import { registerMempalaceExtension } from "./register.js";

vi.mock("./operations.js", () => ({
	createMempalaceOperations: vi.fn(() => ({
		getStatus: vi.fn(),
		sync: vi.fn(),
		search: vi.fn(),
	})),
}));

vi.mock("./register.js", () => ({
	registerMempalaceExtension: vi.fn(),
}));

describe("mempalace extension entrypoint", () => {
	it("creates default operations and registers the extension", () => {
		const pi = {} as ExtensionAPI;
		mempalaceExtension(pi);

		expect(createMempalaceOperations).toHaveBeenCalledTimes(1);
		expect(registerMempalaceExtension).toHaveBeenCalledWith(pi, vi.mocked(createMempalaceOperations).mock.results[0]?.value);
	});
});
