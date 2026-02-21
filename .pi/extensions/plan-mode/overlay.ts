import { type ExtensionContext, type Theme } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import type { PlanOverlayResult, PlanStep } from "./types.js";

interface ShowPlanOverlayParams {
	title: string;
	markdown: string;
	steps: PlanStep[];
}

interface OverlayThemeStyles {
	accent: (text: string) => string;
	muted: (text: string) => string;
	success: (text: string) => string;
	warning: (text: string) => string;
	dim: (text: string) => string;
}

const MAX_STEP_PREVIEW = 7;
const FRAME_SIDE_PADDING = 5;
const FRAME_VERTICAL_PADDING = 2;

export function createThemeStyles(theme: Theme): OverlayThemeStyles {
	return {
		accent: (text: string) => theme.fg("accent", text),
		muted: (text: string) => theme.fg("muted", text),
		success: (text: string) => theme.fg("success", text),
		warning: (text: string) => theme.fg("warning", text),
		dim: (text: string) => theme.fg("dim", text),
	};
}

function renderFrameBorder(
	styles: OverlayThemeStyles,
	width: number,
	left: string,
	fill: string,
	right: string,
): string {
	if (width <= 0) return "";
	if (width === 1) return styles.accent(left);
	if (width === 2) return styles.accent(`${left}${right}`);
	return styles.accent(`${left}${fill.repeat(Math.max(0, width - 2))}${right}`);
}

function renderFramedLine(styles: OverlayThemeStyles, width: number, line = ""): string {
	if (width < 6) return truncateToWidth(line, width);

	const innerWidth = width - (FRAME_SIDE_PADDING * 2 + 2);
	const content = truncateToWidth(line, innerWidth);
	const fill = Math.max(0, innerWidth - visibleWidth(content));
	const side = styles.accent("│");
	return `${side}${" ".repeat(FRAME_SIDE_PADDING)}${content}${" ".repeat(fill + FRAME_SIDE_PADDING)}${side}`;
}

export function renderPlanMarkdownLines(markdown: string, width: number): string[] {
	const lines: string[] = [];
	const safeWidth = Math.max(8, width);

	for (const rawLine of markdown.split(/\r?\n/)) {
		if (rawLine.length === 0) {
			lines.push("");
			continue;
		}
		const wrapped = wrapTextWithAnsi(rawLine, safeWidth);
		if (wrapped.length === 0) lines.push("");
		else lines.push(...wrapped);
	}

	return lines;
}

export function buildProgressBar(progress: number, total: number, width: number): string {
	if (width <= 0) return "";
	if (total <= 0) {
		return "[░░░░░░░░░░]".slice(0, Math.min(width, 10));
	}

	const barWidth = Math.max(8, width);
	const safeTotal = Math.max(total, 1);
	const filled = Math.round((barWidth * progress) / safeTotal);
	const empty = Math.max(0, barWidth - filled);
	return `[${"█".repeat(filled)}${"░".repeat(empty)}]`;
}

export function truncateStepLines(lines: string[], maxLines: number): string[] {
	if (lines.length <= maxLines) return lines;
	return [...lines.slice(0, maxLines), `… ${lines.length - maxLines} more`];
}

export function formatStepPreview(styles: OverlayThemeStyles, theme: Theme, steps: PlanStep[], width: number): string[] {
	if (steps.length === 0) return [styles.muted("(No parsed numbered steps)")];

	const lines: string[] = [];
	const wrappedWidth = Math.max(12, width - 4);

	for (const step of steps.slice(0, MAX_STEP_PREVIEW)) {
		const prefix = step.completed ? styles.success("☑") : styles.muted("☐");
		const label = `${step.step}. ${step.text}`;
		const wrapped = wrapTextWithAnsi(label, wrappedWidth);
		if (wrapped.length === 0) continue;

		for (let index = 0; index < wrapped.length; index++) {
			const wrappedLine = wrapped[index]!;
			if (index === 0) {
				const previewLine = step.completed
					? styles.muted(theme.strikethrough(wrappedLine))
					: wrappedLine;
				lines.push(`${prefix} ${previewLine}`);
			} else {
				lines.push(`   ${wrappedLine}`);
			}
		}
	}

	return truncateStepLines(lines, MAX_STEP_PREVIEW * 2);
}

export function buildOverlayBody(styles: OverlayThemeStyles, theme: Theme, width: number, params: ShowPlanOverlayParams): string[] {
	const lines: string[] = [];
	const add = (line = "") => {
		lines.push(truncateToWidth(line, width));
	};

	const completed = params.steps.filter((step) => step.completed).length;
	const total = params.steps.length;
	const progressPercent = total === 0 ? 0 : Math.round((completed / total) * 100);
	const progressBar = buildProgressBar(completed, total, Math.min(width - 16, 24));

	add(styles.accent(`Plan Review · ${params.title}`));
	add(styles.muted(`${completed}/${total} completed · ${progressPercent}%`));
	add(styles.muted(`Progress: ${progressBar}`));
	add(styles.accent("Step Preview:"));
	for (const line of formatStepPreview(styles, theme, params.steps, width)) {
		add(line);
	}
	add("");

	if (total === 0) {
		add(styles.warning("No numbered steps detected. Auto-completion tracking will be unavailable until plan steps are numbered."));
	} else if (completed === total) {
		add(styles.success("All steps are already marked complete."));
	}

	add(styles.accent("Plan:"));
	const planLines = renderPlanMarkdownLines(params.markdown, Math.max(10, width));
	if (planLines.length === 0) {
		add(styles.muted("(No plan content provided)"));
	} else {
		for (const line of planLines) {
			add(line);
		}
	}

	return lines;
}

export async function showPlanOverlay(ctx: ExtensionContext, params: ShowPlanOverlayParams): Promise<PlanOverlayResult> {
	if (!ctx.hasUI) return { decision: "cancel" };

	return ctx.ui.custom<PlanOverlayResult>(
		(tui, theme, _keybindings, done) => {
			const styles = createThemeStyles(theme);
			let scrollOffset = 0;
			let feedbackMode = false;
			let statusMessage: string | undefined;
			let cachedWidth: number | undefined;
			let cachedLines: string[] | undefined;
			let cachedBodyWidth: number | undefined;
			let cachedBodyLines: string[] = [];

			const editorTheme: EditorTheme = {
				borderColor: styles.accent,
				selectList: {
					selectedPrefix: (text: string) => styles.accent(text),
					selectedText: (text: string) => styles.accent(text),
					description: (text: string) => styles.muted(text),
					scrollInfo: (text: string) => styles.dim(text),
					noMatch: (text: string) => styles.warning(text),
				},
			};
			const editor = new Editor(tui, editorTheme);

			editor.onSubmit = (value: string) => {
				const feedback = value.trim();
				if (!feedback) {
					statusMessage = "Please enter feedback before submitting.";
					requestRender();
					return;
				}
				done({ decision: "refine", feedback });
			};

			function requestRender(): void {
				cachedLines = undefined;
				tui.requestRender();
			}

			function getBodyLines(width: number): string[] {
				if (cachedBodyWidth === width) return cachedBodyLines;
				cachedBodyLines = buildOverlayBody(styles, theme, width, params);
				cachedBodyWidth = width;
				return cachedBodyLines;
			}

			function getFrameHeight(): number {
				const terminalRows = typeof process.stdout.rows === "number" ? process.stdout.rows : 36;
				return Math.max(18, Math.floor(terminalRows * 0.8));
			}

			function clampScroll(maxScroll: number): void {
				if (scrollOffset < 0) scrollOffset = 0;
				if (scrollOffset > maxScroll) scrollOffset = maxScroll;
			}

			function enterFeedbackMode(): void {
				feedbackMode = true;
				statusMessage = undefined;
				editor.setText("");
				requestRender();
			}

			function leaveFeedbackMode(): void {
				feedbackMode = false;
				statusMessage = undefined;
				editor.setText("");
				requestRender();
			}

			function handleInput(data: string): void {
				if (feedbackMode) {
					if (matchesKey(data, Key.escape)) {
						leaveFeedbackMode();
						return;
					}
					editor.handleInput(data);
					requestRender();
					return;
				}

				if (matchesKey(data, Key.up)) {
					scrollOffset -= 1;
					requestRender();
					return;
				}
				if (matchesKey(data, Key.down)) {
					scrollOffset += 1;
					requestRender();
					return;
				}
				if (matchesKey(data, Key.pageUp)) {
					scrollOffset -= 10;
					requestRender();
					return;
				}
				if (matchesKey(data, Key.pageDown)) {
					scrollOffset += 10;
					requestRender();
					return;
				}
				if (matchesKey(data, Key.home)) {
					scrollOffset = 0;
					requestRender();
					return;
				}
				if (matchesKey(data, Key.end)) {
					scrollOffset = Number.MAX_SAFE_INTEGER;
					requestRender();
					return;
				}

				if (matchesKey(data, "a")) {
					done({ decision: "approve_new_session" });
					return;
				}
				if (matchesKey(data, "p")) {
					done({ decision: "proceed_keep_context" });
					return;
				}
				if (matchesKey(data, "f") || matchesKey(data, Key.enter)) {
					enterFeedbackMode();
					return;
				}
				if (matchesKey(data, Key.escape)) {
					done({ decision: "cancel" });
				}
			}

			function render(width: number): string[] {
				if (cachedLines && cachedWidth === width) return cachedLines;
				const lines: string[] = [];
				const add = (line = "") => lines.push(renderFramedLine(styles, width, line));

				const frameHeight = getFrameHeight();
				const footerHeight = feedbackMode ? 8 : 4;
				const viewportHeight = Math.max(8, frameHeight - (footerHeight + 3 + FRAME_VERTICAL_PADDING * 4));

				const contentWidth = Math.max(10, width - (FRAME_SIDE_PADDING * 2 + 2));
				const bodyLines = getBodyLines(contentWidth);
				const maxScroll = Math.max(0, bodyLines.length - viewportHeight);
				clampScroll(maxScroll);

				const start = scrollOffset;
				const end = Math.min(bodyLines.length, start + viewportHeight);

				lines.push(renderFrameBorder(styles, width, "┌", "─", "┐"));
				for (let index = 0; index < FRAME_VERTICAL_PADDING; index++) add("");
				if (start > 0) {
					add(styles.dim("↑ more above"));
				}

				for (let index = start; index < end; index++) {
					add(bodyLines[index] ?? "");
				}

				const visibleCount = end - start;
				for (let index = visibleCount; index < viewportHeight; index++) {
					add("");
				}
				if (end < bodyLines.length) {
					add(styles.dim("↓ more below"));
				}
				for (let index = 0; index < FRAME_VERTICAL_PADDING; index++) add("");

				lines.push(renderFrameBorder(styles, width, "├", "─", "┤"));
				for (let index = 0; index < FRAME_VERTICAL_PADDING; index++) add("");

				if (feedbackMode) {
					add(styles.accent("Feedback (Enter submit • Esc cancel):"));
					const editorLines = editor.render(Math.max(8, contentWidth));
					for (const line of editorLines.slice(-4)) {
						add(line);
					}
					if (statusMessage) add(styles.warning(statusMessage));
				} else {
					add(styles.dim("↑↓ scroll • PgUp/PgDn • Home/End"));
					add(styles.dim("a approve+new session • p proceed here • f refine • Esc close"));
					if (statusMessage) add(styles.warning(statusMessage));
				}
				for (let index = 0; index < FRAME_VERTICAL_PADDING; index++) add("");

				lines.push(renderFrameBorder(styles, width, "└", "─", "┘"));
				cachedWidth = width;
				cachedLines = lines;
				return lines;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
					cachedBodyWidth = undefined;
					editor.invalidate();
				},
				handleInput,
			};
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "95%",
				maxHeight: "95%",
				margin: 1,
			},
		},
	);
}
