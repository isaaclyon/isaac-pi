import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import type { PlanOverlayResult, PlanStep } from "./types.js";

interface ShowPlanOverlayParams {
	title: string;
	markdown: string;
	steps: PlanStep[];
}

function renderPlanMarkdownLines(markdown: string, width: number): string[] {
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

export async function showPlanOverlay(ctx: ExtensionContext, params: ShowPlanOverlayParams): Promise<PlanOverlayResult> {
	if (!ctx.hasUI) return { decision: "cancel" };

	return ctx.ui.custom<PlanOverlayResult>(
		(tui, theme, _keybindings, done) => {
			let scrollOffset = 0;
			let feedbackMode = false;
			let statusMessage: string | undefined;
			let cachedWidth: number | undefined;
			let cachedLines: string[] | undefined;
			let cachedPlanWidth: number | undefined;
			let cachedPlanLines: string[] = [];

			const editorTheme: EditorTheme = {
				borderColor: (text: string) => theme.fg("accent", text),
				selectList: {
					selectedPrefix: (text: string) => theme.fg("accent", text),
					selectedText: (text: string) => theme.fg("accent", text),
					description: (text: string) => theme.fg("muted", text),
					scrollInfo: (text: string) => theme.fg("dim", text),
					noMatch: (text: string) => theme.fg("warning", text),
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

			function getPlanLines(width: number): string[] {
				if (cachedPlanWidth === width) return cachedPlanLines;
				cachedPlanLines = renderPlanMarkdownLines(params.markdown, width);
				cachedPlanWidth = width;
				return cachedPlanLines;
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
				const add = (line = "") => lines.push(truncateToWidth(line, width));

				const frameHeight = getFrameHeight();
				const footerHeight = feedbackMode ? 8 : 4;
				const viewportHeight = Math.max(6, frameHeight - (5 + footerHeight));

				const planLines = getPlanLines(Math.max(10, width));
				const maxScroll = Math.max(0, planLines.length - viewportHeight);
				clampScroll(maxScroll);

				const start = scrollOffset;
				const end = Math.min(planLines.length, start + viewportHeight);
				const completed = params.steps.filter((step) => step.completed).length;
				const stepSummary = `${completed}/${params.steps.length}`;

				const border = theme.fg("accent", "─".repeat(Math.max(1, width)));
				add(border);
				add(theme.fg("accent", theme.bold(`Plan Review · ${params.title}`)));
				add(theme.fg("muted", `Steps ${stepSummary} • Lines ${start + 1}-${Math.max(start + 1, end)}/${Math.max(1, planLines.length)}`));
				add(border);
				if (start > 0) add(theme.fg("dim", "↑ more above"));

				for (let index = start; index < end; index++) {
					add(planLines[index] ?? "");
				}

				const visibleCount = end - start;
				for (let i = visibleCount; i < viewportHeight; i++) {
					add("");
				}
				if (end < planLines.length) add(theme.fg("dim", "↓ more below"));
				add(border);

				if (feedbackMode) {
					add(theme.fg("accent", "Feedback (Enter submit • Esc cancel):"));
					const editorLines = editor.render(Math.max(10, width - 2));
					for (const line of editorLines.slice(-4)) {
						add(` ${line}`);
					}
					if (statusMessage) add(theme.fg("warning", statusMessage));
				} else {
					add(theme.fg("dim", "↑↓ scroll • PgUp/PgDn • Home/End"));
					add(theme.fg("dim", "a approve+new session • p proceed here • f refine • Esc close"));
					if (statusMessage) add(theme.fg("warning", statusMessage));
				}

				add(border);
				cachedWidth = width;
				cachedLines = lines;
				return lines;
			}

			return {
				render,
				invalidate: () => {
					cachedLines = undefined;
					cachedPlanWidth = undefined;
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
