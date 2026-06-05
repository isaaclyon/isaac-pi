import assert from "node:assert/strict";
import test from "node:test";
import {
	buildQuestionnaireResponse,
	buildTimeoutGuidance,
	DECLINE_MESSAGE,
	ENVELOPE_PREFIX,
	ENVELOPE_SUFFIX,
	TIMEOUT_GUIDANCE_PREFIX,
	TIMEOUT_GUIDANCE_SUFFIX,
} from "./response-envelope.ts";
import type { QuestionParams, QuestionnaireResult } from "./types.ts";

const params: QuestionParams = {
	questions: [
		{
			question: "Which runtime should we use?",
			header: "Runtime",
			options: [
				{ label: "Node", description: "Use Node.js" },
				{ label: "Bun", description: "Use Bun" },
			],
		},
		{
			question: "Which package manager should we use?",
			header: "Package",
			options: [
				{ label: "npm", description: "Use npm" },
				{ label: "pnpm", description: "Use pnpm" },
			],
		},
	],
};

test("buildQuestionnaireResponse preserves the answered-question envelope when no timeout occurred", () => {
	const result: QuestionnaireResult = {
		answers: [
			{
				questionIndex: 0,
				question: params.questions[0]!.question,
				kind: "option",
				answer: "Node",
			},
		],
		cancelled: false,
	};

	assert.deepEqual(buildQuestionnaireResponse(result, params), {
		content: [
			{
				type: "text",
				text: `${ENVELOPE_PREFIX} "Which runtime should we use?"="Node". ${ENVELOPE_SUFFIX}`,
			},
		],
		details: result,
	});
});

test("buildQuestionnaireResponse returns timeout guidance without marking timeout-only results cancelled", () => {
	const result: QuestionnaireResult = {
		answers: [],
		cancelled: false,
		timeout: {
			completedByTimeout: true,
			timedOutQuestions: [{ questionIndex: 0, question: params.questions[0]!.question }],
		},
	};

	const response = buildQuestionnaireResponse(result, params);
	assert.equal(
		response.content[0]!.text,
		`${TIMEOUT_GUIDANCE_PREFIX} "Which runtime should we use?". ${TIMEOUT_GUIDANCE_SUFFIX}`,
	);
	assert.equal(response.details.cancelled, false);
	assert.deepEqual(response.details.timeout, result.timeout);
});

test("buildQuestionnaireResponse appends timeout guidance after real collected answers", () => {
	const result: QuestionnaireResult = {
		answers: [
			{
				questionIndex: 1,
				question: params.questions[1]!.question,
				kind: "option",
				answer: "pnpm",
			},
		],
		cancelled: false,
		timeout: {
			completedByTimeout: false,
			timedOutQuestions: [{ questionIndex: 0, question: params.questions[0]!.question }],
		},
	};

	assert.equal(
		buildQuestionnaireResponse(result, params).content[0]!.text,
		`${ENVELOPE_PREFIX} "Which package manager should we use?"="pnpm". ${ENVELOPE_SUFFIX} ${TIMEOUT_GUIDANCE_PREFIX} "Which runtime should we use?". ${TIMEOUT_GUIDANCE_SUFFIX}`,
	);
});

test("buildTimeoutGuidance names every timed-out unanswered question", () => {
	assert.equal(
		buildTimeoutGuidance({
			completedByTimeout: false,
			timedOutQuestions: [
				{ questionIndex: 0, question: params.questions[0]!.question },
				{ questionIndex: 1, question: params.questions[1]!.question },
			],
		}),
		`${TIMEOUT_GUIDANCE_PREFIX} "Which runtime should we use?", "Which package manager should we use?". ${TIMEOUT_GUIDANCE_SUFFIX}`,
	);
});

test("buildQuestionnaireResponse keeps generic decline behavior for non-timeout empty results", () => {
	const result: QuestionnaireResult = { answers: [], cancelled: false };
	const response = buildQuestionnaireResponse(result, params);
	assert.equal(response.content[0]!.text, DECLINE_MESSAGE);
	assert.equal(response.details.cancelled, true);
	assert.equal(response.details.timeout, undefined);
});
