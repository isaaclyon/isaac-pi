/**
 * Questionnaire Tool - Unified tool for asking single or multiple questions.
 *
 * Features:
 * - Single question: simple options list
 * - Multiple questions: tab bar navigation
 * - Optional multi-select per question: checkbox-style selection with Space
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, Text, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

interface QuestionOption {
	value: string;
	label: string;
	description?: string;
	recommended?: boolean;
}

type RenderOption = QuestionOption & { isOther?: boolean };

interface Question {
	id: string;
	label: string;
	prompt: string;
	options: QuestionOption[];
	allowOther: boolean;
	multiSelect: boolean;
}

interface SingleAnswer {
	id: string;
	mode: "single";
	value: string;
	label: string;
	wasCustom: boolean;
	index?: number;
}

interface MultiAnswer {
	id: string;
	mode: "multi";
	values: string[];
	labels: string[];
	indices: number[]; // 1-based indexes for selected predefined options
	customValue?: string;
}

type Answer = SingleAnswer | MultiAnswer;

interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}

const QuestionOptionSchema = Type.Object({
	value: Type.String({ description: "The value returned when selected" }),
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
	recommended: Type.Optional(Type.Boolean({ description: "Marks this option as the recommended choice" })),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question" }),
	label: Type.Optional(
		Type.String({
			description: "Short contextual label for tab bar, e.g. 'Scope', 'Priority' (defaults to Q1, Q2)",
		}),
	),
	prompt: Type.String({ description: "The full question text to display" }),
	options: Type.Array(QuestionOptionSchema, { description: "Available options to choose from" }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow 'Type something' option (default: true)" })),
	multiSelect: Type.Optional(
		Type.Boolean({
			description: "Allow selecting multiple options for this question (checkbox mode, default: false)",
		}),
	),
});

const QuestionnaireParams = Type.Object({
	questions: Type.Array(QuestionSchema, { description: "Questions to ask the user" }),
});

function errorResult(
	message: string,
	questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
	return {
		content: [{ type: "text", text: message }],
		details: { questions, answers: [], cancelled: true },
	};
}

function isSingleAnswer(answer: Answer | undefined): answer is SingleAnswer {
	return answer?.mode === "single";
}

function isMultiAnswer(answer: Answer | undefined): answer is MultiAnswer {
	return answer?.mode === "multi";
}

export default function questionnaire(pi: ExtensionAPI) {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description:
			"Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. Supports single-choice and optional multi-select (checkbox) questions.",
		parameters: QuestionnaireParams,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return errorResult("Error: UI not available (running in non-interactive mode)");
			}
			if (params.questions.length === 0) {
				return errorResult("Error: No questions provided");
			}

			const questions: Question[] = params.questions.map((q, i) => {
				const normalizedOptions = q.options.map((option) => ({ ...option, recommended: option.recommended === true }));
				const firstRecommendedIndex = normalizedOptions.findIndex((option) => option.recommended === true);
				if (normalizedOptions.length > 0) {
					const enforcedRecommendedIndex = firstRecommendedIndex >= 0 ? firstRecommendedIndex : 0;
					for (let optionIndex = 0; optionIndex < normalizedOptions.length; optionIndex++) {
						normalizedOptions[optionIndex] = {
							...normalizedOptions[optionIndex],
							recommended: optionIndex === enforcedRecommendedIndex,
						};
					}
				}

				return {
					...q,
					options: normalizedOptions,
					label: q.label || `Q${i + 1}`,
					allowOther: q.allowOther !== false,
					multiSelect: q.multiSelect === true,
				};
			});

			const seenIds = new Set<string>();
			for (const q of questions) {
				if (seenIds.has(q.id)) {
					return errorResult(`Error: Duplicate question id '${q.id}'`, questions);
				}
				seenIds.add(q.id);

				if (q.options.length === 0 && !q.allowOther) {
					return errorResult(`Error: Question '${q.id}' has no options and allowOther=false`, questions);
				}
			}

			const questionById = new Map(questions.map((q) => [q.id, q]));
			const isMultiQuestionnaire = questions.length > 1;
			const totalTabs = questions.length + 1; // + Submit tab

			const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
				let currentTab = 0;
				let optionIndex = 0;
				let inputMode = false;
				let inputQuestionId: string | null = null;
				let statusMessage: string | null = null;
				let cachedLines: string[] | undefined;
				const answers = new Map<string, Answer>();

				const editorTheme: EditorTheme = {
					borderColor: (s) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t) => theme.fg("accent", t),
						selectedText: (t) => theme.fg("accent", t),
						description: (t) => theme.fg("muted", t),
						scrollInfo: (t) => theme.fg("dim", t),
						noMatch: (t) => theme.fg("warning", t),
					},
				};
				const editor = new Editor(tui, editorTheme);

				function refresh() {
					cachedLines = undefined;
					tui.requestRender();
				}

				function setStatus(message: string | null) {
					statusMessage = message;
					refresh();
				}

				function submit(cancelled: boolean) {
					done({ questions, answers: Array.from(answers.values()), cancelled });
				}

				function currentQuestion(): Question | undefined {
					return questions[currentTab];
				}

				function optionsFor(question: Question): RenderOption[] {
					const opts: RenderOption[] = [...question.options];
					if (question.allowOther) {
						opts.push({
							value: "__other__",
							label: "Type something.",
							isOther: true,
							recommended: opts.length === 0,
						});
					}
					return opts;
				}

				function currentOptions(): RenderOption[] {
					const q = currentQuestion();
					if (!q) return [];
					return optionsFor(q);
				}

				function allAnswered(): boolean {
					return questions.every((q) => answers.has(q.id));
				}

				function saveSingleAnswer(questionId: string, value: string, label: string, wasCustom: boolean, index?: number) {
					answers.set(questionId, { id: questionId, mode: "single", value, label, wasCustom, index });
				}

				function getMultiSelection(questionId: string): { selected: Set<number>; customValue?: string } {
					const answer = answers.get(questionId);
					if (!isMultiAnswer(answer)) {
						return { selected: new Set<number>() };
					}

					const selected = new Set<number>();
					for (const index of answer.indices) {
						selected.add(index - 1); // convert to 0-based
					}
					return { selected, customValue: answer.customValue };
				}

				function saveMultiAnswer(questionId: string, opts: RenderOption[], selected: Set<number>, customValue?: string) {
					const orderedIndexes = Array.from(selected)
						.filter((i) => i >= 0 && i < opts.length && !opts[i]?.isOther)
						.sort((a, b) => a - b);

					const values: string[] = [];
					const labels: string[] = [];
					const indices: number[] = [];

					for (const idx of orderedIndexes) {
						const option = opts[idx];
						if (!option || option.isOther) continue;
						values.push(option.value);
						labels.push(option.label);
						indices.push(idx + 1);
					}

					if (values.length === 0 && !customValue) {
						answers.delete(questionId);
						return;
					}

					answers.set(questionId, {
						id: questionId,
						mode: "multi",
						values,
						labels,
						indices,
						customValue,
					});
				}

				function hasMultiSelection(questionId: string): boolean {
					return isMultiAnswer(answers.get(questionId));
				}

				function advanceAfterAnswer() {
					setStatus(null);
					if (!isMultiQuestionnaire) {
						submit(false);
						return;
					}
					if (currentTab < questions.length - 1) {
						currentTab++;
					} else {
						currentTab = questions.length;
					}
					optionIndex = 0;
					refresh();
				}

				editor.onSubmit = (value) => {
					if (!inputQuestionId) return;
					const question = questionById.get(inputQuestionId);
					if (!question) return;

					const trimmed = value.trim() || "(no response)";

					if (question.multiSelect) {
						const opts = optionsFor(question);
						const state = getMultiSelection(question.id);
						saveMultiAnswer(question.id, opts, state.selected, trimmed);
						inputMode = false;
						inputQuestionId = null;
						editor.setText("");
						setStatus(null);
						return;
					}

					saveSingleAnswer(question.id, trimmed, trimmed, true);
					inputMode = false;
					inputQuestionId = null;
					editor.setText("");
					advanceAfterAnswer();
				};

				function openCustomInput(questionId: string) {
					inputMode = true;
					inputQuestionId = questionId;
					editor.setText("");
					setStatus(null);
				}

				function handleInput(data: string) {
					if (inputMode) {
						if (matchesKey(data, Key.escape)) {
							inputMode = false;
							inputQuestionId = null;
							editor.setText("");
							setStatus(null);
							return;
						}
						editor.handleInput(data);
						refresh();
						return;
					}

					const q = currentQuestion();
					const opts = currentOptions();

					if (isMultiQuestionnaire) {
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentTab = (currentTab + 1) % totalTabs;
							optionIndex = 0;
							setStatus(null);
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTab = (currentTab - 1 + totalTabs) % totalTabs;
							optionIndex = 0;
							setStatus(null);
							return;
						}
					}

					if (currentTab === questions.length) {
						if (matchesKey(data, Key.enter) && allAnswered()) {
							submit(false);
						} else if (matchesKey(data, Key.enter)) {
							setStatus("Please answer all questions before submitting.");
						} else if (matchesKey(data, Key.escape)) {
							submit(true);
						}
						return;
					}

					if (!q) return;

					if (matchesKey(data, Key.up)) {
						optionIndex = Math.max(0, optionIndex - 1);
						setStatus(null);
						return;
					}

					if (matchesKey(data, Key.down)) {
						optionIndex = Math.min(Math.max(0, opts.length - 1), optionIndex + 1);
						setStatus(null);
						return;
					}

					if (q.multiSelect) {
						const selectedOption = opts[optionIndex];

						// Space toggles only. For "Type something.", space opens input (or removes existing custom text).
						if (matchesKey(data, Key.space) && selectedOption?.isOther) {
							const state = getMultiSelection(q.id);
							if (state.customValue) {
								saveMultiAnswer(q.id, opts, state.selected, undefined);
							} else {
								openCustomInput(q.id);
							}
							setStatus(null);
							return;
						}

						if (matchesKey(data, Key.space) && selectedOption && !selectedOption.isOther) {
							const state = getMultiSelection(q.id);
							if (state.selected.has(optionIndex)) {
								state.selected.delete(optionIndex);
							} else {
								state.selected.add(optionIndex);
							}
							saveMultiAnswer(q.id, opts, state.selected, state.customValue);
							setStatus(null);
							return;
						}

						// Enter always continues (never clears/reopens custom text).
						if (matchesKey(data, Key.enter)) {
							if (hasMultiSelection(q.id)) {
								advanceAfterAnswer();
							} else {
								setStatus("Select at least one option (Space to toggle).");
							}
							return;
						}
					} else {
						if (matchesKey(data, Key.enter)) {
							const selectedOption = opts[optionIndex];
							if (!selectedOption) return;
							if (selectedOption.isOther) {
								openCustomInput(q.id);
								return;
							}

							saveSingleAnswer(q.id, selectedOption.value, selectedOption.label, false, optionIndex + 1);
							advanceAfterAnswer();
							return;
						}
					}

					if (matchesKey(data, Key.escape)) {
						submit(true);
					}
				}

				function formatAnswerPreview(answer: Answer): string {
					if (isSingleAnswer(answer)) {
						if (answer.wasCustom) return `(wrote) ${answer.label}`;
						if (answer.index) return `${answer.index}. ${answer.label}`;
						return answer.label;
					}

					const pieces: string[] = [];
					if (answer.indices.length > 0) {
						const indexed = answer.indices.map((index, i) => `${index}. ${answer.labels[i] ?? ""}`.trim());
						pieces.push(indexed.join(", "));
					}
					if (answer.customValue) {
						pieces.push(`(wrote) ${answer.customValue}`);
					}
					return pieces.join(" + ");
				}

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;

					const lines: string[] = [];
					const q = currentQuestion();
					const opts = currentOptions();
					const add = (s: string) => lines.push(truncateToWidth(s, width));

					add(theme.fg("accent", "─".repeat(width)));

					if (isMultiQuestionnaire) {
						const tabs: string[] = ["← "];
						for (let i = 0; i < questions.length; i++) {
							const question = questions[i];
							const isActive = i === currentTab;
							const isAnswered = answers.has(question.id);
							const marker = isAnswered ? "■" : "□";
							const tabText = ` ${marker} ${question.label} `;
							const styled = isActive
								? theme.bg("selectedBg", theme.fg("text", tabText))
								: theme.fg(isAnswered ? "success" : "muted", tabText);
							tabs.push(`${styled} `);
						}

						const canSubmit = allAnswered();
						const submitActive = currentTab === questions.length;
						const submitText = " ✓ Submit ";
						const submitStyled = submitActive
							? theme.bg("selectedBg", theme.fg("text", submitText))
							: theme.fg(canSubmit ? "success" : "dim", submitText);

						tabs.push(`${submitStyled} →`);
						add(` ${tabs.join("")}`);
						lines.push("");
					}

					function renderOptions(question: Question) {
						const multiState = question.multiSelect ? getMultiSelection(question.id) : undefined;

						for (let i = 0; i < opts.length; i++) {
							const opt = opts[i];
							const selected = i === optionIndex;
							const cursor = selected ? theme.fg("accent", "> ") : "  ";
							const color = selected ? "accent" : "text";

							const recommendedBadge = opt.recommended ? ` ${theme.fg("warning", "★ recommended")}` : "";

							if (question.multiSelect && multiState) {
								const checked = opt.isOther ? Boolean(multiState.customValue) : multiState.selected.has(i);
								const checkbox = checked ? "[x]" : "[ ]";
								let label = `${i + 1}. ${checkbox} ${opt.label}`;
								if (opt.isOther && multiState.customValue) {
									label += ` (${multiState.customValue})`;
								}
								add(cursor + theme.fg(color, label) + recommendedBadge);
							} else {
								add(cursor + theme.fg(color, `${i + 1}. ${opt.label}`) + recommendedBadge);
							}

							if (opt.description) {
								add(`     ${theme.fg("muted", opt.description)}`);
							}
						}
					}

					if (inputMode && q) {
						add(theme.fg("text", ` ${q.prompt}`));
						lines.push("");
						renderOptions(q);
						lines.push("");
						add(theme.fg("muted", " Your answer:"));
						for (const line of editor.render(Math.max(1, width - 2))) {
							add(` ${line}`);
						}
						lines.push("");
						add(theme.fg("dim", " Enter to submit • Esc to cancel"));
					} else if (currentTab === questions.length) {
						add(theme.fg("accent", theme.bold(" Ready to submit")));
						lines.push("");
						for (const question of questions) {
							const answer = answers.get(question.id);
							if (!answer) continue;
							add(`${theme.fg("muted", ` ${question.label}: `)}${theme.fg("text", formatAnswerPreview(answer))}`);
						}
						lines.push("");
						if (allAnswered()) {
							add(theme.fg("success", " Press Enter to submit"));
						} else {
							const missing = questions
								.filter((question) => !answers.has(question.id))
								.map((question) => question.label)
								.join(", ");
							add(theme.fg("warning", ` Unanswered: ${missing}`));
						}
					} else if (q) {
						add(theme.fg("text", ` ${q.prompt}`));
						lines.push("");
						renderOptions(q);
					}

					lines.push("");
					if (statusMessage) {
						add(theme.fg("warning", ` ${statusMessage}`));
					}

					if (!inputMode) {
						if (currentTab === questions.length) {
							add(theme.fg("dim", " Enter submit • Esc cancel"));
						} else {
							const questionHelp = q?.multiSelect
								? " ↑↓ navigate • Space toggle • Enter continue • Esc cancel"
								: " ↑↓ navigate • Enter select • Esc cancel";
							if (isMultiQuestionnaire) {
								add(theme.fg("dim", ` Tab/←→ switch •${questionHelp}`));
							} else {
								add(theme.fg("dim", questionHelp));
							}
						}
					}

					add(theme.fg("accent", "─".repeat(width)));
					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate: () => {
						cachedLines = undefined;
					},
					handleInput,
				};
			});

			if (result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled the questionnaire" }],
					details: result,
				};
			}

			const answerLines = result.answers.map((answer) => {
				const qLabel = questions.find((q) => q.id === answer.id)?.label || answer.id;

				if (isSingleAnswer(answer)) {
					if (answer.wasCustom) {
						return `${qLabel}: user wrote: ${answer.label}`;
					}
					return `${qLabel}: user selected: ${answer.index}. ${answer.label}`;
				}

				const segments: string[] = [];
				if (answer.indices.length > 0) {
					const selected = answer.indices.map((idx, i) => `${idx}. ${answer.labels[i] ?? ""}`.trim()).join(", ");
					segments.push(`user selected: ${selected}`);
				}
				if (answer.customValue) {
					segments.push(`user wrote: ${answer.customValue}`);
				}
				return `${qLabel}: ${segments.join(" + ")}`;
			});

			return {
				content: [{ type: "text", text: answerLines.join("\n") }],
				details: result,
			};
		},

		renderCall(args, theme) {
			const qs = (args.questions as Array<{ id: string; label?: string; multiSelect?: boolean }>) || [];
			const count = qs.length;
			const labels = qs.map((q) => q.label || q.id).join(", ");
			const multiCount = qs.filter((q) => q.multiSelect === true).length;

			let text = theme.fg("toolTitle", theme.bold("questionnaire "));
			text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
			if (multiCount > 0) {
				text += theme.fg("dim", ` • ${multiCount} multi-select`);
			}
			if (labels) {
				text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuestionnaireResult | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}
			if (details.cancelled) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}

			const lines = details.answers.map((answer) => {
				if (isSingleAnswer(answer)) {
					if (answer.wasCustom) {
						return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`;
					}
					const display = answer.index ? `${answer.index}. ${answer.label}` : answer.label;
					return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${display}`;
				}

				const selections = answer.indices.map((index, i) => `${index}. ${answer.labels[i] ?? ""}`.trim()).join(", ");
				const chunks: string[] = [];
				if (selections) chunks.push(selections);
				if (answer.customValue) chunks.push(`${theme.fg("muted", "(wrote) ")}${answer.customValue}`);
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${chunks.join(" + ")}`;
			});

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
