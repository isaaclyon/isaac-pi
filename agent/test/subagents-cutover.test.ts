import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");

function readRepoFile(relativePath: string): string {
	return readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("pi-subagents cutover", () => {
	it("installs the official pi-subagents package instead of the legacy scoped package", () => {
		const settings = JSON.parse(readRepoFile("agent/settings.json")) as {
			packages?: string[];
		};

		expect(settings.packages).toContain("npm:pi-subagents");
		expect(settings.packages).not.toContain("npm:@tintinweb/pi-subagents");
	});

	it("removes manual dispatch-only guidance for subagents from append system prompts", () => {
		for (const filePath of ["APPEND_SYSTEM.md", ".pi/APPEND_SYSTEM.md"]) {
			const contents = readRepoFile(filePath);
			expect(contents).not.toContain("When delegating to subagents, use `interactive_shell` with `mode=\"dispatch\"` by default.");
		}
	});
});
