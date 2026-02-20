import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { extractPlanSteps, isSafeReadOnlyBashCommand, markCompletedSteps, saveApprovedPlan, toPlanFilename } from "./utils.js";

describe("plan-mode utils", () => {
	it("extracts numbered steps from the Steps section", () => {
		const markdown = `## Goal\nDo x\n\n## Steps\n1. Audit the service logs\n2. Propose schema updates\n3. Write tests\n\n## Risks\n- Rate limits`;
		const steps = extractPlanSteps(markdown);

		expect(steps).toHaveLength(3);
		expect(steps.map((step) => step.step)).toEqual([1, 2, 3]);
		expect(steps.map((step) => step.text)).toEqual([
			"Audit the service logs",
			"Propose schema updates",
			"Write tests",
		]);
	});

	it("marks completed steps from DONE markers", () => {
		const steps = [
			{ step: 1, text: "One", completed: false },
			{ step: 2, text: "Two", completed: false },
		];
		const updatedCount = markCompletedSteps("Done [DONE:1] and then [DONE:2]", steps);

		expect(updatedCount).toBe(2);
		expect(steps.every((step) => step.completed)).toBe(true);
	});

	it("enforces read-only bash allowlist", () => {
		expect(isSafeReadOnlyBashCommand("ls -la")).toBe(true);
		expect(isSafeReadOnlyBashCommand("git status")).toBe(true);
		expect(isSafeReadOnlyBashCommand("npm install")).toBe(false);
		expect(isSafeReadOnlyBashCommand("rm -rf src")).toBe(false);
	});

	it("creates timestamped filenames", () => {
		const now = new Date(2026, 1, 20, 9, 35, 0, 0);
		expect(toPlanFilename("My Plan", now)).toBe("2026-02-20-09-35-my-plan.md");
	});

	it("saves approved plan to docs/plans with metadata", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "plan-mode-test-"));
		try {
			const saved = await saveApprovedPlan({
				cwd,
				title: "Release Prep",
				markdown: "## Goal\nShip it",
				decision: "keep_context",
				sessionFile: "/tmp/sessions/abc123.jsonl",
			});

			const fullPath = join(cwd, saved.relativePath);
			const file = await readFile(fullPath, "utf8");

			expect(saved.relativePath.startsWith("docs/plans/")).toBe(true);
			expect(file).toContain("status: approved");
			expect(file).toContain("decision: keep_context");
			expect(file).toContain("sessionId: abc123");
			expect(file).toContain("# Release Prep");
		} finally {
			await rm(cwd, { recursive: true, force: true });
		}
	});
});
