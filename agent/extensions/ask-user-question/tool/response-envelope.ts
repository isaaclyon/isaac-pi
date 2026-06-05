import { formatAnswerScalar } from "./format-answer.js";
import type { QuestionAnswer, QuestionnaireResult, QuestionParams, QuestionnaireTimeoutDetails } from "./types.js";

export const DECLINE_MESSAGE = "User declined to answer questions";
export const ENVELOPE_PREFIX = "User has answered your questions:";
export const ENVELOPE_SUFFIX = "You can now continue with the user's answers in mind.";
export const TIMEOUT_GUIDANCE_PREFIX = "The user did not answer these questions in time:";
export const TIMEOUT_GUIDANCE_SUFFIX =
	"Proceed only if you have a strong recommendation; otherwise wait for the user.";

/**
 * Map a `QuestionnaireResult` (or null/cancelled) to the LLM-facing tool envelope.
 * Pure of `(result, params)`; cancelled and non-timeout empty results fall to
 * `DECLINE_MESSAGE` so the model sees one canonical "didn't answer" signal.
 */
export function buildQuestionnaireResponse(result: QuestionnaireResult | null | undefined, params: QuestionParams) {
	if (!result || result.cancelled) {
		return buildToolResult(DECLINE_MESSAGE, {
			answers: result?.answers ?? [],
			cancelled: true,
			...(result?.timeout ? { timeout: result.timeout } : {}),
		});
	}
	const segments: string[] = [];
	for (let i = 0; i < params.questions.length; i++) {
		const a = result.answers.find((x) => x.questionIndex === i);
		if (a) segments.push(buildAnswerSegment(a));
	}
	const timeoutGuidance = buildTimeoutGuidance(result.timeout);
	if (segments.length === 0) {
		if (timeoutGuidance) return buildToolResult(timeoutGuidance, result);
		return buildToolResult(DECLINE_MESSAGE, { answers: result.answers, cancelled: true });
	}
	const answeredEnvelope = `${ENVELOPE_PREFIX} ${segments.join(" ")} ${ENVELOPE_SUFFIX}`;
	return buildToolResult(timeoutGuidance ? `${answeredEnvelope} ${timeoutGuidance}` : answeredEnvelope, result);
}

/**
 * Format a single answer segment for the envelope. Pure of `a`. The `"Q"="A"` shape and
 * the optional `selected preview:` / `user notes:` suffixes are pinned by envelope tests.
 */
export function buildAnswerSegment(a: QuestionAnswer): string {
	const parts: string[] = [`"${a.question}"="${formatAnswerScalar(a, "envelope")}"`];
	if (a.preview && a.preview.length > 0) parts.push(`selected preview: ${a.preview}`);
	if (a.notes && a.notes.length > 0) parts.push(`user notes: ${a.notes}`);
	return `${parts.join(". ")}.`;
}

export function buildTimeoutGuidance(timeout: QuestionnaireTimeoutDetails | undefined): string | undefined {
	if (!timeout || timeout.timedOutQuestions.length === 0) return undefined;
	const questions = timeout.timedOutQuestions.map((entry) => `"${entry.question}"`).join(", ");
	return `${TIMEOUT_GUIDANCE_PREFIX} ${questions}. ${TIMEOUT_GUIDANCE_SUFFIX}`;
}

export function buildToolResult(text: string, details: QuestionnaireResult) {
	return {
		content: [{ type: "text" as const, text }],
		details,
	};
}
