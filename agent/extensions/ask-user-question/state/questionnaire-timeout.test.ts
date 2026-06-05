import assert from "node:assert/strict";
import test from "node:test";
import type { QuestionAnswer, QuestionData } from "../tool/types.ts";
import {
	QuestionTimeoutController,
	questionTimeoutSecondsFor,
	recordTimedOutQuestion,
	type TimeoutScheduler,
} from "./questionnaire-timeout.ts";
import { reduce, type ApplyContext } from "./state-reducer.ts";
import type { QuestionnaireState } from "./state.ts";

class FakeScheduler implements TimeoutScheduler {
	private nowMs = 0;
	private nextId = 1;
	private readonly timeouts = new Map<number, { at: number; callback: () => void }>();
	private readonly intervals = new Map<number, { at: number; everyMs: number; callback: () => void }>();

	now(): number {
		return this.nowMs;
	}

	setTimeout(callback: () => void, ms: number): unknown {
		const id = this.nextId++;
		this.timeouts.set(id, { at: this.nowMs + ms, callback });
		return id;
	}

	clearTimeout(handle: unknown): void {
		this.timeouts.delete(handle as number);
	}

	setInterval(callback: () => void, ms: number): unknown {
		const id = this.nextId++;
		this.intervals.set(id, { at: this.nowMs + ms, everyMs: ms, callback });
		return id;
	}

	clearInterval(handle: unknown): void {
		this.intervals.delete(handle as number);
	}

	advance(ms: number): void {
		const target = this.nowMs + ms;
		while (true) {
			let next:
				| { kind: "timeout" | "interval"; id: number; at: number; callback: () => void; everyMs?: number }
				| undefined;
			for (const [id, timeout] of this.timeouts) {
				if (timeout.at > target) continue;
				if (!next || timeout.at < next.at || (timeout.at === next.at && id < next.id)) {
					next = { kind: "timeout", id, at: timeout.at, callback: timeout.callback };
				}
			}
			for (const [id, interval] of this.intervals) {
				if (interval.at > target) continue;
				if (!next || interval.at < next.at || (interval.at === next.at && id < next.id)) {
					next = { kind: "interval", id, at: interval.at, everyMs: interval.everyMs, callback: interval.callback };
				}
			}
			if (!next) break;
			this.nowMs = next.at;
			if (next.kind === "timeout") {
				this.timeouts.delete(next.id);
			} else {
				const interval = this.intervals.get(next.id);
				if (interval) interval.at += next.everyMs!;
			}
			next.callback();
		}
		this.nowMs = target;
	}
}

const questions: QuestionData[] = [
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
];

const ctx: ApplyContext = {
	questions,
	itemsByTab: [[], []],
};

function buildState(overrides: Partial<QuestionnaireState> = {}): QuestionnaireState {
	return {
		currentTab: 0,
		optionIndex: 0,
		inputMode: false,
		notesVisible: false,
		chatFocused: false,
		answers: new Map<number, QuestionAnswer>(),
		multiSelectChecked: new Set<number>(),
		notesByTab: new Map<number, string>(),
		focusedOptionHasPreview: false,
		submitChoiceIndex: 0,
		notesDraft: "",
		timeout: {
			enabled: true,
			remainingSeconds: 2,
			timedOutQuestions: [],
			completedByTimeout: false,
		},
		...overrides,
	};
}

test("questionTimeoutSecondsFor uses the configured first-question and later-question values", () => {
	assert.equal(questionTimeoutSecondsFor({ initialQuestionSeconds: 7, questionSeconds: 2 }, 0), 7);
	assert.equal(questionTimeoutSecondsFor({ initialQuestionSeconds: 7, questionSeconds: 2 }, 1), 2);
	assert.equal(questionTimeoutSecondsFor({ initialQuestionSeconds: 7, questionSeconds: 2 }, 5), 2);
	assert.equal(questionTimeoutSecondsFor(undefined, 0), undefined);
});

test("recordTimedOutQuestion deduplicates entries and skips answered questions", () => {
	assert.deepEqual(recordTimedOutQuestion([], 0, questions[0]!.question, false), []);
	assert.deepEqual(recordTimedOutQuestion([], 0, questions[0]!.question), [
		{ questionIndex: 0, question: questions[0]!.question },
	]);
	assert.deepEqual(
		recordTimedOutQuestion([{ questionIndex: 0, question: questions[0]!.question }], 0, questions[0]!.question),
		[{ questionIndex: 0, question: questions[0]!.question }],
	);
});

test("QuestionTimeoutController resets the deadline on repeated active-question input", () => {
	const scheduler = new FakeScheduler();
	const controller = new QuestionTimeoutController(scheduler);
	let expirations = 0;

	controller.arm(7, {
		onTick: () => {},
		onExpire: () => {
			expirations += 1;
		},
	});
	scheduler.advance(6900);
	assert.equal(expirations, 0);

	controller.arm(7, {
		onTick: () => {},
		onExpire: () => {
			expirations += 1;
		},
	});
	scheduler.advance(6900);
	assert.equal(expirations, 0);
	scheduler.advance(100);
	assert.equal(expirations, 1);
});

test("QuestionTimeoutController resets cleanly while notes typing continues", () => {
	const scheduler = new FakeScheduler();
	const controller = new QuestionTimeoutController(scheduler);
	let expirations = 0;

	controller.arm(2, {
		onTick: () => {},
		onExpire: () => {
			expirations += 1;
		},
	});
	scheduler.advance(1900);
	controller.arm(2, {
		onTick: () => {},
		onExpire: () => {
			expirations += 1;
		},
	});
	scheduler.advance(1900);
	assert.equal(expirations, 0);
	scheduler.advance(100);
	assert.equal(expirations, 1);
});

test("QuestionTimeoutController clear wins over a nearly-simultaneous expiry", () => {
	const scheduler = new FakeScheduler();
	const controller = new QuestionTimeoutController(scheduler);
	let expirations = 0;

	controller.arm(1, {
		onTick: () => {},
		onExpire: () => {
			expirations += 1;
		},
	});
	scheduler.advance(900);
	controller.clear();
	scheduler.advance(200);
	assert.equal(expirations, 0);
});

test("reduce auto-advances unanswered timed-out intermediate questions without creating synthetic answers", () => {
	const result = reduce(buildState(), { kind: "question_timeout" }, ctx);
	assert.equal(result.state.currentTab, 1);
	assert.equal(result.state.answers.size, 0);
	assert.equal(result.state.timeout.completedByTimeout, false);
	assert.deepEqual(result.state.timeout.timedOutQuestions, [
		{ questionIndex: 0, question: questions[0]!.question },
	]);
	assert.equal(result.effects.some((effect) => effect.kind === "done"), false);
});

test("reduce clears stale timeout metadata when the user later answers that question", () => {
	const result = reduce(
		buildState({
			timeout: {
				enabled: true,
				remainingSeconds: 2,
				timedOutQuestions: [{ questionIndex: 0, question: questions[0]!.question }],
				completedByTimeout: false,
			},
		}),
		{
			kind: "confirm",
			answer: {
				questionIndex: 0,
				question: questions[0]!.question,
				kind: "option",
				answer: "Node",
			},
		},
		ctx,
	);
	assert.deepEqual(result.state.timeout.timedOutQuestions, []);
});

test("reduce auto-closes the final timed-out question as a non-cancelled timeout completion", () => {
	const result = reduce(
		buildState({ currentTab: 1, timeout: { enabled: true, remainingSeconds: 1, timedOutQuestions: [], completedByTimeout: false } }),
		{ kind: "question_timeout" },
		ctx,
	);
	assert.equal(result.state.answers.size, 0);
	assert.equal(result.effects.length, 1);
	assert.equal(result.effects[0]!.kind, "done");
	if (result.effects[0]!.kind !== "done") throw new Error("expected done effect");
	assert.equal(result.effects[0].result.cancelled, false);
	assert.deepEqual(result.effects[0].result.timeout, {
		completedByTimeout: true,
		timedOutQuestions: [{ questionIndex: 1, question: questions[1]!.question }],
	});
});

test("reduce does not emit timeout completion metadata when an already-answered final question times out", () => {
	const answers = new Map<number, QuestionAnswer>([
		[
			1,
			{
				questionIndex: 1,
				question: questions[1]!.question,
				kind: "option",
				answer: "pnpm",
			},
		],
	]);
	const result = reduce(
		buildState({
			currentTab: 1,
			answers,
			timeout: { enabled: true, remainingSeconds: 1, timedOutQuestions: [], completedByTimeout: false },
		}),
		{ kind: "question_timeout" },
		ctx,
	);
	assert.equal(result.effects[0]!.kind, "done");
	if (result.effects[0]!.kind !== "done") throw new Error("expected done effect");
	assert.equal(result.effects[0].result.timeout, undefined);
	assert.deepEqual(result.effects[0].result.answers, [...answers.values()]);
});
