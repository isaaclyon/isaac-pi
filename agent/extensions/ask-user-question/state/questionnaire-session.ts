import type { Theme } from "@earendil-works/pi-coding-agent";
import { getKeybindings, type Input } from "@earendil-works/pi-tui";
import type { TimeoutFields } from "../config.js";
import type { QuestionData, QuestionnaireResult, QuestionParams } from "../tool/types.js";
import type { WrappingSelectItem } from "../view/components/wrapping-select.js";
import type { QuestionnairePropsAdapter } from "../view/props-adapter.js";
import { buildQuestionnaire } from "./build-questionnaire.js";
import { displayLabel } from "./i18n-bridge.js";
import {
	QuestionTimeoutController,
	questionTimeoutSecondsFor,
	type TimeoutScheduler,
} from "./questionnaire-timeout.js";
import { type QuestionnaireAction, routeKey } from "./key-router.js";
import { computeFocusedOptionHasPreview } from "./selectors/derivations.js";
import type { QuestionnaireRuntime, QuestionnaireState } from "./state.js";
import { type ApplyContext, type Effect, reduce } from "./state-reducer.js";

// Module-level constant; reused for cursor-end mutations after setValue rehydration.
// Ctrl-E → tui.editor.cursorLineEnd (public path; pi-tui keybindings.js:25-28).
const CURSOR_END = "\x05";

export interface QuestionnaireSessionConfig {
	tui: { terminal: { columns: number; rows: number }; requestRender(): void };
	theme: Theme;
	params: QuestionParams;
	itemsByTab: WrappingSelectItem[][];
	done: (result: QuestionnaireResult) => void;
	timeout?: TimeoutFields;
	timerScheduler?: TimeoutScheduler;
}

export interface QuestionnaireSessionComponent {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
}

function initialState(timeoutEnabled: boolean): QuestionnaireState {
	return {
		currentTab: 0,
		optionIndex: 0,
		inputMode: false,
		notesVisible: false,
		chatFocused: false,
		answers: new Map(),
		multiSelectChecked: new Set(),
		notesByTab: new Map(),
		focusedOptionHasPreview: false,
		submitChoiceIndex: 0,
		notesDraft: "",
		timeout: {
			enabled: timeoutEnabled,
			remainingSeconds: null,
			timedOutQuestions: [],
			completedByTimeout: false,
		},
	};
}

/**
 * Slim runtime: owns the canonical state cell, the input-buffer cell, the
 * two-pass `notesVisible` dispatch loop, and the effect runner. State
 * transitions go through the pure `reduce` reducer; UI fan-out goes through
 * the `QuestionnairePropsAdapter` produced by `buildQuestionnaire`.
 */
export class QuestionnaireSession {
	private state: QuestionnaireState;
	private completed = false;

	private readonly questions: readonly QuestionData[];
	private readonly isMulti: boolean;
	private readonly itemsByTab: WrappingSelectItem[][];

	private readonly notesInput: Input;
	private readonly inlineInput: Input;
	private readonly viewAdapter: QuestionnairePropsAdapter;
	private readonly timeoutController?: QuestionTimeoutController;
	private readonly timeoutConfig?: TimeoutFields;

	private readonly tui: QuestionnaireSessionConfig["tui"];
	private readonly done: QuestionnaireSessionConfig["done"];

	readonly component: QuestionnaireSessionComponent;

	constructor(config: QuestionnaireSessionConfig) {
		this.tui = config.tui;
		this.done = config.done;
		this.questions = config.params.questions;
		this.isMulti = this.questions.length > 1;
		this.itemsByTab = config.itemsByTab;
		this.timeoutConfig = config.timeout;
		this.timeoutController = config.timeout ? new QuestionTimeoutController(config.timerScheduler) : undefined;
		this.state = initialState(config.timeout !== undefined);
		// Seed from the focused option at start; the reducer keeps it in sync via withFocusedOptionHasPreview.
		this.state = { ...this.state, focusedOptionHasPreview: computeFocusedOptionHasPreview(this.questions, 0, 0) };

		const built = buildQuestionnaire({
			tui: this.tui,
			theme: config.theme,
			questions: this.questions,
			itemsByTab: this.itemsByTab,
			isMulti: this.isMulti,
			initialState: this.state,
			getCurrentTab: () => this.state.currentTab,
		});

		this.notesInput = built.notesInput;
		this.inlineInput = built.inlineInput;
		this.viewAdapter = built.adapter;

		this.component = {
			render: built.render,
			invalidate: built.invalidate,
			handleInput: (data) => this.dispatch(data),
		};

		this.syncTimeoutForCurrentState();
		this.viewAdapter.apply(this.state);
	}

	dispatch(data: string): void {
		if (this.completed) return;
		const action = routeKey(data, this.state, this.runtime());
		if (action.kind === "ignore") {
			this.handleIgnoreInline(data);
			return;
		}
		this.commit(action);
	}

	private commit(action: QuestionnaireAction): void {
		if (this.completed) return;
		const result = reduce(this.state, action, this.applyContext());
		this.state = result.state;
		for (const effect of result.effects) this.runEffect(effect);
		if (this.completed) return;
		this.state = this.mirrorNotesDraft(this.state);
		this.syncTimeoutForCurrentState();
		this.viewAdapter.apply(this.state);
	}

	private mirrorNotesDraft(state: QuestionnaireState): QuestionnaireState {
		const draft = this.notesInput.getValue();
		return state.notesDraft === draft ? state : { ...state, notesDraft: draft };
	}

	private runEffect(effect: Effect): void {
		switch (effect.kind) {
			case "set_input_buffer":
				this.inlineInput.setValue(effect.value);
				this.inlineInput.handleInput(CURSOR_END);
				return;
			case "clear_input_buffer":
				this.inlineInput.setValue("");
				return;
			case "set_notes_value":
				this.notesInput.setValue(effect.value);
				return;
			case "set_notes_focused":
				this.notesInput.focused = effect.focused;
				return;
			case "forward_notes_keystroke":
				this.notesInput.handleInput(effect.data);
				return;
			case "done":
				this.complete(effect.result);
				return;
		}
	}

	private complete(result: QuestionnaireResult): void {
		if (this.completed) return;
		this.completed = true;
		this.timeoutController?.clear();
		this.done(result);
	}

	/**
	 * Per-keystroke `ignore` fast path: delegates to the headless `inlineInput`
	 * Input so bracketed-paste accumulator (`input.js:33-63`) and Kitty CSI-u
	 * decode (`input.js:155-163`) take effect. Cursor is NOT force-reset here —
	 * doing so would corrupt split-chunk pastes (a `\x05` byte mid-paste lands
	 * verbatim in `pasteBuffer` and survives `handlePaste`'s narrow strip).
	 * Cursor advances naturally via `insertCharacter` on typing/paste; cursor-
	 * movement keys (Left/Right/Home/End/word-jumps) are now functional, with
	 * the always-end visual cursor marker drawn independently by
	 * `WrappingSelect.renderInlineInputRow`. `viewAdapter.apply` is called
	 * directly without a reducer round-trip — preserves the D3 fast-path
	 * latency profile from Phase 11.
	 */
	private handleIgnoreInline(data: string): void {
		if (!this.state.inputMode || this.completed) return;
		this.inlineInput.handleInput(data);
		this.syncTimeoutForCurrentState();
		this.viewAdapter.apply(this.state);
	}

	private syncTimeoutForCurrentState(): void {
		if (!this.timeoutController || !this.timeoutConfig || this.completed) return;
		const durationSeconds = this.activeQuestionTimeoutSeconds();
		if (durationSeconds === undefined) {
			this.timeoutController.clear();
			this.setRemainingSeconds(null);
			return;
		}
		this.setRemainingSeconds(durationSeconds);
		this.timeoutController.arm(durationSeconds, {
			onTick: (remainingSeconds) => {
				if (this.completed) return;
				this.setRemainingSeconds(remainingSeconds);
				this.viewAdapter.apply(this.state);
			},
			onExpire: () => {
				if (this.completed) return;
				this.commit({ kind: "question_timeout" });
			},
		});
	}

	private activeQuestionTimeoutSeconds(): number | undefined {
		if (this.state.currentTab >= this.questions.length) return undefined;
		return questionTimeoutSecondsFor(this.timeoutConfig, this.state.currentTab);
	}

	private setRemainingSeconds(remainingSeconds: number | null): void {
		if (this.state.timeout.remainingSeconds === remainingSeconds) return;
		this.state = {
			...this.state,
			timeout: { ...this.state.timeout, remainingSeconds },
		};
	}

	private runtime(): QuestionnaireRuntime {
		return {
			keybindings: getKeybindings(),
			inputBuffer: this.inlineInput.getValue(),
			questions: this.questions,
			isMulti: this.isMulti,
			currentItem: this.currentItem(),
			items: this.itemsByTab[this.state.currentTab] ?? [],
		};
	}

	private applyContext(): ApplyContext {
		return {
			questions: this.questions,
			itemsByTab: this.itemsByTab,
		};
	}

	private currentItem(): WrappingSelectItem | undefined {
		if (this.state.chatFocused) return { kind: "chat", label: displayLabel("chat") };
		const items = this.itemsByTab[this.state.currentTab] ?? [];
		if (this.state.optionIndex < items.length) return items[this.state.optionIndex];
		return { kind: "chat", label: displayLabel("chat") };
	}
}
