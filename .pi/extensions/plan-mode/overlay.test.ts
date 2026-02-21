import type { Theme } from "@mariozechner/pi-coding-agent";
import { beforeEach, describe, expect, it } from "vitest";

import { buildOverlayBody, buildProgressBar, createThemeStyles, formatStepPreview, renderPlanMarkdownLines } from "./overlay.js";
import type { PlanStep } from "./types.js";

interface PlanOverlayParams {
	title: string;
	markdown: string;
	steps: PlanStep[];
}

function createMockTheme(): Theme {
	return {
		fg: (color: string, text: string) => `[${color}]${text}`,
		bg: () => "",
		bold: (text: string) => `*${text}*`,
		italic: (text: string) => `_${text}_`,
		underline: (text: string) => `~${text}~`,
		inverse: (text: string) => `!${text}!`,
		strikethrough: (text: string) => `~~${text}~~`,
		getFgAnsi: () => "",
		getBgAnsi: () => "",
		getColorMode: () => "truecolor",
		getThinkingBorderColor: () => (text: string) => text,
		getBashModeBorderColor: () => (text: string) => text,
	} as unknown as Theme;
}

function createStyles(theme: Theme) {
	return createThemeStyles(theme);
}

function makeParams(steps: PlanStep[]): PlanOverlayParams {
	return {
		title: "Implementation Plan",
		markdown: "## Goal\nShip it\n\n## Steps\n1. Run tests\n2. Deploy",
		steps,
	};
}

describe("plan-mode overlay helpers", () => {
	let theme: Theme;

	beforeEach(() => {
		theme = createMockTheme();
	});

	describe("progress bar", () => {
		it("returns an empty bar for non-total context", () => {
			expect(buildProgressBar(0, 0, 0)).toBe("");
			expect(buildProgressBar(0, 0, 9)).toHaveLength(9);
		});

		it("scales fill based on completion", () => {
			expect(buildProgressBar(2, 4, 4)).toBe("[████░░░░]");
		});
	});

	describe("markdown rendering", () => {
		it("preserves blank lines", () => {
			expect(renderPlanMarkdownLines("line one\n\nline two", 20)).toEqual(["line one", "", "line two"]);
		});
	});

	describe("step preview", () => {
		it("highlights completed steps with a strikethrough style", () => {
			const styles = createStyles(theme);
			const steps: PlanStep[] = [
				{ step: 1, text: "Run tests", completed: true },
				{ step: 2, text: "Deploy", completed: false },
			];

			const lines = formatStepPreview(styles, theme, steps, 80);
			expect(lines).toHaveLength(2);
			expect(lines[0]).toContain("[success]☑");
			expect(lines[0]).toContain("~~1. Run tests~~");
			expect(lines[1]).toContain("[muted]☐");
			expect(lines[1]).toContain("2. Deploy");
		});

		it("reports missing numbered steps", () => {
			const styles = createStyles(theme);
			const lines = formatStepPreview(styles, theme, [], 80);
			expect(lines).toEqual(["[muted](No parsed numbered steps)"]);
		});
	});

	describe("overlay body", () => {
		it("builds a summary with progress and plan content", () => {
			const styles = createStyles(theme);
			const params = makeParams([
				{ step: 1, text: "Run tests", completed: true },
				{ step: 2, text: "Deploy", completed: false },
			]);

			const lines = buildOverlayBody(styles, theme, 100, params);
			expect(lines).toContain("[accent]Plan Review · Implementation Plan");
			expect(lines).toContain("[muted]1/2 completed · 50%");
			expect(lines).toContain("[accent]Step Preview:");
			expect(lines.some((line) => line.includes("[accent]Plan:"))).toBe(true);
			expect(lines).toContain("## Goal");
			expect(lines).toContain("## Steps");
			expect(lines.some((line) => line.includes("[muted]~~1. Run tests~~"))).toBe(true);
		});

		it("warns when no steps are available", () => {
			const styles = createStyles(theme);
			const params = makeParams([]);
			const lines = buildOverlayBody(styles, theme, 100, params);
			const warningText = "[warning]No numbered steps detected.";
			const hasWarning = lines.some((line) => line.includes(warningText));

			expect(hasWarning).toBe(true);
		});
	});
});
