import { describe, expect, it, vi } from "vitest";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import ralphLoopExtension from "./index.js";

describe("ralph-loop extension", () => {
	it("registers lifecycle handlers", () => {
		const handlers: Record<string, unknown> = {};
		const pi = {
			on: vi.fn((name: string, handler: unknown) => {
				handlers[name] = handler;
			}),
		} as unknown as ExtensionAPI;

		ralphLoopExtension(pi);

		expect(typeof handlers.session_start).toBe("function");
		expect(typeof handlers.session_shutdown).toBe("function");
	});
});
