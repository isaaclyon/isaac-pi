import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import worktreeExtension from "./index.js";
import { registerWorktreeTools } from "./register-tools.js";

vi.mock("./register-tools.js", () => ({
	registerWorktreeTools: vi.fn(),
}));

describe("worktree extension entrypoint", () => {
	it("delegates to registerWorktreeTools", () => {
		const pi = {} as ExtensionAPI;
		worktreeExtension(pi);
		expect(vi.mocked(registerWorktreeTools)).toHaveBeenCalledWith(pi);
	});
});
