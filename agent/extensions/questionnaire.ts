/**
 * Questionnaire Tool - Unified tool for asking single or multiple questions.
 *
 * Features:
 * - Single question: simple options list
 * - Multiple questions: tab bar navigation
 * - Optional multi-select per question: checkbox-style selection with Space
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, Text, matchesKey, parseKey, truncateToWidth } from "@mariozechner/pi-tui";
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
	note?: string;
}

interface MultiAnswer {
	id: string;
	mode: "multi";
	values: string[];
	labels: string[];
	indices: number[]; // 1-based indexes for selected predefined options
	customValue?: string;
	note?: string;
}

type Answer = SingleAnswer | MultiAnswer;

interface QuestionnaireResult {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}

type InputPurpose = "custom" | "note";

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
				let inputPurpose: InputPurpose = "custom";
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

				function saveSingleAnswer(
					questionId: string,
					value: string,
					label: string,
					wasCustom: boolean,
					index?: number,
					note?: string,
				) {
					answers.set(questionId, { id: questionId, mode: "single", value, label, wasCustom, index, note });
				}

				function getAnswerNote(questionId: string): string | undefined {
					const answer = answers.get(questionId);
					if (isSingleAnswer(answer) || isMultiAnswer(answer)) {
						return answer.note;
					}
					return undefined;
				}

				function getMultiSelection(questionId: string): { selected: Set<number>; customValue?: string; note?: string } {
					const answer = answers.get(questionId);
					if (!isMultiAnswer(answer)) {
						return { selected: new Set<number>() };
					}

					const selected = new Set<number>();
					for (const index of answer.indices) {
						selected.add(index - 1); // convert to 0-based
					}
					return { selected, customValue: answer.customValue, note: answer.note };
				}

				function saveMultiAnswer(
					questionId: string,
					opts: RenderOption[],
					selected: Set<number>,
					customValue?: string,
					note?: string,
				) {
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
						note,
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

				function closeInput() {
					inputMode = false;
					inputPurpose = "custom";
					inputQuestionId = null;
					editor.setText("");
				}

				editor.onSubmit = (value) => {
					if (!inputQuestionId) return;
					const question = questionById.get(inputQuestionId);
					if (!question) return;

					const trimmed = value.trim();

					if (inputPurpose === "note") {
						const note = trimmed || undefined;
						if (question.multiSelect) {
							const opts = optionsFor(question);
							const state = getMultiSelection(question.id);
							if (state.selected.size === 0 && !state.customValue) {
								closeInput();
								setStatus("Select at least one option before adding a note.");
								return;
							}
							saveMultiAnswer(question.id, opts, state.selected, state.customValue, note);
							closeInput();
							setStatus(null);
							return;
						}

						const answer = answers.get(question.id);
						if (!isSingleAnswer(answer)) {
							closeInput();
							setStatus("Select an answer before adding a note.");
							return;
						}

						saveSingleAnswer(question.id, answer.value, answer.label, answer.wasCustom, answer.index, note);
						closeInput();
						advanceAfterAnswer();
						return;
					}

					const customValue = trimmed || "(no response)";
					if (question.multiSelect) {
						const opts = optionsFor(question);
						const state = getMultiSelection(question.id);
						saveMultiAnswer(question.id, opts, state.selected, customValue, state.note);
						closeInput();
						setStatus(null);
						return;
					}

					saveSingleAnswer(question.id, customValue, customValue, true, undefined, getAnswerNote(question.id));
					closeInput();
					advanceAfterAnswer();
				};

				function openCustomInput(questionId: string) {
					inputMode = true;
					inputPurpose = "custom";
					inputQuestionId = questionId;
					editor.setText("");
					setStatus(null);
				}

				function openNoteInput(questionId: string) {
					inputMode = true;
					inputPurpose = "note";
					inputQuestionId = questionId;
					editor.setText(getAnswerNote(questionId) ?? "");
					setStatus(null);
				}

				function matchesLetterShortcut(data: string, letter: string): boolean {
					if (data === letter) return true;
					const parsed = parseKey(data);
					return parsed === letter;
				}

				function parseOptionShortcutIndex(data: string): number | null {
					if (data.length === 1 && data >= "1" && data <= "9") {
						return Number(data) - 1;
					}

					const parsed = parseKey(data);
					if (parsed && parsed.length === 1 && parsed >= "1" && parsed <= "9") {
						return Number(parsed) - 1;
					}

					// Kitty protocol may send digits as CSI-u sequences, which parseKey currently
					// does not normalize into "1"-"9" key names.
					const kittyDigitMatch = data.match(/^\x1b\[(\d+)(?::\d*)?(?::\d+)?(?:;(\d+))?(?::(\d+))?u$/);
					if (!kittyDigitMatch) return null;

					const codepoint = Number(kittyDigitMatch[1]);
					const modifierValue = kittyDigitMatch[2] ? Number(kittyDigitMatch[2]) : 1;
					const eventType = kittyDigitMatch[3] ? Number(kittyDigitMatch[3]) : 1;
					const isUnmodifiedPress = modifierValue === 1 && eventType !== 3;
					if (isUnmodifiedPress && codepoint >= 49 && codepoint <= 57) {
						return codepoint - 49;
					}

					return null;
				}

				function handleInput(data: string) {
					if (inputMode) {
						if (matchesKey(data, Key.escape)) {
							closeInput();
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

					if (matchesLetterShortcut(data, "n")) {
						const selectedOption = opts[optionIndex];
						if (!selectedOption) {
							setStatus("Select an option before adding a note.");
							return;
						}

						if (q.multiSelect) {
							const state = getMultiSelection(q.id);
							if (state.selected.size === 0 && !state.customValue) {
								setStatus("Select at least one option before adding a note.");
								return;
							}
							openNoteInput(q.id);
							return;
						}

						if (selectedOption.isOther) {
							setStatus("Select a predefined option before adding a note.");
							return;
						}

						saveSingleAnswer(
							q.id,
							selectedOption.value,
							selectedOption.label,
							false,
							optionIndex + 1,
							getAnswerNote(q.id),
						);
						openNoteInput(q.id);
						return;
					}

					const shortcutIndex = parseOptionShortcutIndex(data);
					if (shortcutIndex !== null) {
						if (shortcutIndex < 0 || shortcutIndex >= opts.length) {
							setStatus(`Option ${shortcutIndex + 1} is not available.`);
							return;
						}

						optionIndex = shortcutIndex;
						const selectedOption = opts[shortcutIndex];
						if (!selectedOption) return;

						if (q.multiSelect) {
							const state = getMultiSelection(q.id);
							if (selectedOption.isOther) {
								if (state.customValue) {
									saveMultiAnswer(q.id, opts, state.selected, undefined, state.note);
								} else {
									openCustomInput(q.id);
								}
							} else if (state.selected.has(shortcutIndex)) {
								state.selected.delete(shortcutIndex);
								saveMultiAnswer(q.id, opts, state.selected, state.customValue, state.note);
							} else {
								state.selected.add(shortcutIndex);
								saveMultiAnswer(q.id, opts, state.selected, state.customValue, state.note);
							}
							setStatus(null);
							return;
						}

						if (selectedOption.isOther) {
							openCustomInput(q.id);
							return;
						}

						saveSingleAnswer(
							q.id,
							selectedOption.value,
							selectedOption.label,
							false,
							shortcutIndex + 1,
							getAnswerNote(q.id),
						);
						advanceAfterAnswer();
						return;
					}

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
								saveMultiAnswer(q.id, opts, state.selected, undefined, state.note);
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
							saveMultiAnswer(q.id, opts, state.selected, state.customValue, state.note);
							setStatus(null);
							return;
						}

						// Enter always continues (never clears/reopens custom text).
						if (matchesKey(data, Key.enter)) {
							if (hasMultiSelection(q.id)) {
								advanceAfterAnswer();
							} else {
								setStatus("Select at least one option (Space or 1-9 to toggle).");
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

							saveSingleAnswer(q.id, selectedOption.value, selectedOption.label, false, optionIndex + 1, getAnswerNote(q.id));
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
						let preview = answer.wasCustom
							? `(wrote) ${answer.label}`
							: answer.index
								? `${answer.index}. ${answer.label}`
								: answer.label;
						if (answer.note) {
							preview += ` + note: ${answer.note}`;
						}
						return preview;
					}

					const pieces: string[] = [];
					if (answer.indices.length > 0) {
						const indexed = answer.indices.map((index, i) => `${index}. ${answer.labels[i] ?? ""}`.trim());
						pieces.push(indexed.join(", "));
					}
					if (answer.customValue) {
						pieces.push(`(wrote) ${answer.customValue}`);
					}
					if (answer.note) {
						pieces.push(`note: ${answer.note}`);
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
						const inputLabel = inputPurpose === "note" ? " Your note:" : " Your answer:";
						add(theme.fg("muted", inputLabel));
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
								? " ↑↓ navigate • 1-9 quick toggle • Space toggle • N note • Enter continue • Esc cancel"
								: " ↑↓ navigate • 1-9 quick select • N note • Enter select • Esc cancel";
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
					const base = answer.wasCustom
						? `${qLabel}: user wrote: ${answer.label}`
						: `${qLabel}: user selected: ${answer.index}. ${answer.label}`;
					return answer.note ? `${base} + note: ${answer.note}` : base;
				}

				const segments: string[] = [];
				if (answer.indices.length > 0) {
					const selected = answer.indices.map((idx, i) => `${idx}. ${answer.labels[i] ?? ""}`.trim()).join(", ");
					segments.push(`user selected: ${selected}`);
				}
				if (answer.customValue) {
					segments.push(`user wrote: ${answer.customValue}`);
				}
				if (answer.note) {
					segments.push(`note: ${answer.note}`);
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
					const base = answer.wasCustom
						? `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${theme.fg("muted", "(wrote) ")}${answer.label}`
						: `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${answer.index ? `${answer.index}. ${answer.label}` : answer.label}`;
					return answer.note ? `${base} + ${theme.fg("muted", "note: ")}${answer.note}` : base;
				}

				const selections = answer.indices.map((index, i) => `${index}. ${answer.labels[i] ?? ""}`.trim()).join(", ");
				const chunks: string[] = [];
				if (selections) chunks.push(selections);
				if (answer.customValue) chunks.push(`${theme.fg("muted", "(wrote) ")}${answer.customValue}`);
				if (answer.note) chunks.push(`${theme.fg("muted", "note: ")}${answer.note}`);
				return `${theme.fg("success", "✓ ")}${theme.fg("accent", answer.id)}: ${chunks.join(" + ")}`;
			});

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
