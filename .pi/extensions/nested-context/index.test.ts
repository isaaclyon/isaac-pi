import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

import { __test } from "./index.js";

async function writeTextFile(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

describe("nested-context helpers", () => {
	it("uses AGENTS-first fallback defaults", () => {
		const config = __test.normalizeConfig(undefined);
		expect(config.fileSelectionMode).toBe("agents-first-fallback-claude");
		expect(config.strictFirstHit).toBe(true);
		expect(config.maxChars).toBe(__test.DEFAULT_CONFIG.maxChars);
	});

	it("falls back to CLAUDE.md when AGENTS.md is missing", async () => {
		const root = await mkdtemp(join(tmpdir(), "nested-context-"));
		const packageDir = join(root, "packages", "api");

		await writeTextFile(join(root, "AGENTS.md"), "root rules");
		await writeTextFile(join(packageDir, "CLAUDE.md"), "package claude rules");

		const discovered = await __test.discoverInstructionFiles(
			root,
			packageDir,
			"agents-first-fallback-claude",
			false,
		);

		expect(discovered.map((entry) => entry.kind)).toEqual(["CLAUDE.md"]);
		expect(discovered.map((entry) => entry.path)).toEqual([
			join(packageDir, "CLAUDE.md"),
		]);
	});

	it("prefers AGENTS.md when both exist in one directory", async () => {
		const root = await mkdtemp(join(tmpdir(), "nested-context-"));
		const appDir = join(root, "packages", "app");

		await writeTextFile(join(appDir, "AGENTS.md"), "agents rules");
		await writeTextFile(join(appDir, "CLAUDE.md"), "claude rules");

		const discovered = await __test.discoverForDirectory(appDir, "agents-first-fallback-claude");
		expect(discovered).toHaveLength(1);
		expect(discovered[0].kind).toBe("AGENTS.md");
	});

	it("loads both files in both mode", async () => {
		const root = await mkdtemp(join(tmpdir(), "nested-context-"));
		await writeTextFile(join(root, "AGENTS.md"), "agents rules");
		await writeTextFile(join(root, "CLAUDE.md"), "claude rules");

		const discovered = await __test.discoverForDirectory(root, "both");
		expect(discovered.map((entry) => entry.kind)).toEqual(["AGENTS.md", "CLAUDE.md"]);
	});

	it("builds and truncates context text", () => {
		const text = __test.buildContextMessage(
			[
				{
					path: "/repo/packages/app/AGENTS.md",
					kind: "AGENTS.md",
					mtimeMs: 1,
					depthFromCwd: 2,
					content: "A".repeat(5000),
				},
			],
			400,
		);

		expect(text).toBeDefined();
		expect(text?.length).toBeLessThanOrEqual(420);
		expect(text).toContain("[TRUNCATED]");
	});
});
