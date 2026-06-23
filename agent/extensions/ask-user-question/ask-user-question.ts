import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { beginQuestionAttention } from "./attention.js";
import { loadConfig, validateGuidanceFields } from "./config.js";
import { displayLabel } from "./state/i18n-bridge.js";
import { QuestionnaireSession } from "./state/questionnaire-session.js";
import { sentinelsToAppend } from "./state/row-intent.js";
import { buildQuestionnaireResponse, buildToolResult } from "./tool/response-envelope.js";
import {
	MAX_OPTIONS,
	MAX_QUESTIONS,
	MIN_OPTIONS,
	type QuestionData,
	type QuestionnaireResult,
	type QuestionParams,
	QuestionParamsSchema,
} from "./tool/types.js";
import { validateQuestionnaire } from "./tool/validate-questionnaire.js";
import type { WrappingSelectItem } from "./view/components/wrapping-select.js";

const ERROR_NO_UI = "Error: UI not available (running in non-interactive mode)";

export function buildItemsForQuestion(question: QuestionData): WrappingSelectItem[] {
	const items: WrappingSelectItem[] = question.options.map((option) => ({
		kind: "option",
		label: option.label,
		description: option.description,
	}));
	const hasAnyPreview = question.options.some(
		(option) => typeof option.preview === "string" && option.preview.length > 0,
	);
	for (const kind of sentinelsToAppend(question, hasAnyPreview)) {
		items.push({ kind, label: displayLabel(kind) });
	}
	return items;
}

export const DEFAULT_PROMPT_SNIPPET = `Ask the user up to ${MAX_QUESTIONS} structured questions (${MIN_OPTIONS}-${MAX_OPTIONS} options each) when requirements are ambiguous`;
export const DEFAULT_PROMPT_GUIDELINES: string[] = [
	`Use ask_user_question when the request is underspecified and you need concrete decisions before proceeding. Ask up to ${MAX_QUESTIONS} questions in one invocation.`,
	`Each question MUST have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option needs a short label and a description. Do not author sentinel rows like "Other", "Type something.", or "Chat about this" yourself.`,
	`Use multiSelect: true when multiple answers are valid. Use options[].preview only for single-select comparisons that benefit from side-by-side context. If you recommend an option, put it first and append "(Recommended)" to its label.`,
	"Group clarifying questions into one ask_user_question call instead of stacking multiple calls back-to-back.",
];

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
	const config = loadConfig();
	const guidance = validateGuidanceFields(config.guidance);
	const timeout = config.timeout;
	pi.registerTool({
		name: "ask_user_question",
		label: "Ask User Question",
		description: `Ask the user one or more structured questions during execution. Use this to gather preferences, clarify ambiguity, or get decisions before proceeding.

Each question must have ${MIN_OPTIONS}-${MAX_OPTIONS} options. Every option needs a short label and a description.

Do not author sentinel rows like "Other", "Type something.", or "Chat about this" yourself; the UI adds them when appropriate.

Use multiSelect: true when multiple answers are valid. Use options[].preview only for single-select comparisons that benefit from side-by-side context. If you recommend an option, put it first and append "(Recommended)" to its label.`,
		promptSnippet: guidance.promptSnippet ?? DEFAULT_PROMPT_SNIPPET,
		promptGuidelines: guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES,
		parameters: QuestionParamsSchema,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const typed = params as unknown as QuestionParams;
			if (!ctx.hasUI) return buildToolResult(ERROR_NO_UI, { answers: [], cancelled: true, error: "no_ui" });

			const validation = validateQuestionnaire(typed);
			if (!validation.ok) {
				return buildToolResult(validation.message, {
					answers: [],
					cancelled: true,
					error: validation.error,
				});
			}

			const itemsByTab: WrappingSelectItem[][] = typed.questions.map((question) => buildItemsForQuestion(question));
			const endAttention = beginQuestionAttention(ctx, typed);

			try {
				const result = await ctx.ui.custom<QuestionnaireResult>((tui, theme, _kb, done) => {
					const session = new QuestionnaireSession({
						tui,
						theme,
						params: typed,
						itemsByTab,
						done,
						timeout,
					});
					return session.component;
				});

				return buildQuestionnaireResponse(result, typed);
			} finally {
				endAttention();
			}
		},
	});
}

export { buildQuestionnaireResponse, buildToolResult };
