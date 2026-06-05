import type { TimeoutFields } from "../config.js";
import type { TimedOutQuestion } from "../tool/types.js";

const TICK_INTERVAL_MS = 250;

export interface TimeoutScheduler {
	now(): number;
	setTimeout(callback: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	setInterval(callback: () => void, ms: number): unknown;
	clearInterval(handle: unknown): void;
}

export interface QuestionTimeoutCallbacks {
	onTick(remainingSeconds: number): void;
	onExpire(): void;
}

const SYSTEM_TIMEOUT_SCHEDULER: TimeoutScheduler = {
	now: () => Date.now(),
	setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
	clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
	setInterval: (callback, ms) => globalThis.setInterval(callback, ms),
	clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
};

export function questionTimeoutSecondsFor(timeout: TimeoutFields | undefined, questionIndex: number): number | undefined {
	if (!timeout) return undefined;
	return questionIndex === 0 ? timeout.initialQuestionSeconds : timeout.questionSeconds;
}

export function remainingSecondsUntil(deadlineMs: number, nowMs: number): number {
	return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export function recordTimedOutQuestion(
	existing: readonly TimedOutQuestion[],
	questionIndex: number,
	question: string,
	shouldRecord = true,
): TimedOutQuestion[] {
	if (!shouldRecord) return [...existing];
	if (existing.some((entry) => entry.questionIndex === questionIndex)) return [...existing];
	return [...existing, { questionIndex, question }];
}

export class QuestionTimeoutController {
	private generation = 0;
	private timeoutHandle: unknown;
	private intervalHandle: unknown;
	private lastRemainingSeconds: number | undefined;
	private readonly scheduler: TimeoutScheduler;

	constructor(scheduler: TimeoutScheduler = SYSTEM_TIMEOUT_SCHEDULER) {
		this.scheduler = scheduler;
	}

	arm(durationSeconds: number, callbacks: QuestionTimeoutCallbacks): void {
		this.generation += 1;
		const generation = this.generation;
		this.clearHandles();
		this.lastRemainingSeconds = undefined;
		const deadlineMs = this.scheduler.now() + durationSeconds * 1000;
		this.timeoutHandle = this.scheduler.setTimeout(() => {
			if (generation !== this.generation) return;
			this.clearHandles();
			this.emitRemaining(0, callbacks);
			callbacks.onExpire();
		}, durationSeconds * 1000);
		this.intervalHandle = this.scheduler.setInterval(() => {
			if (generation !== this.generation) return;
			this.emitRemaining(remainingSecondsUntil(deadlineMs, this.scheduler.now()), callbacks);
		}, TICK_INTERVAL_MS);
	}

	clear(): void {
		this.generation += 1;
		this.clearHandles();
		this.lastRemainingSeconds = undefined;
	}

	private emitRemaining(remainingSeconds: number, callbacks: QuestionTimeoutCallbacks): void {
		if (this.lastRemainingSeconds === remainingSeconds) return;
		this.lastRemainingSeconds = remainingSeconds;
		callbacks.onTick(remainingSeconds);
	}

	private clearHandles(): void {
		if (this.timeoutHandle !== undefined) {
			this.scheduler.clearTimeout(this.timeoutHandle);
			this.timeoutHandle = undefined;
		}
		if (this.intervalHandle !== undefined) {
			this.scheduler.clearInterval(this.intervalHandle);
			this.intervalHandle = undefined;
		}
	}
}
