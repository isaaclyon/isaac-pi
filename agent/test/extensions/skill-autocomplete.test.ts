import { describe, expect, it, vi } from "vitest";

import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { AutocompleteProvider, AutocompleteSuggestions } from "@mariozechner/pi-tui";
import {
	SkillAutocompleteEditor,
	createSkillAutocompleteExtension,
	createSkillAutocompleteProvider,
	extractSkillToken,
	filterSkills,
	shouldAutoTriggerSkillAutocomplete,
} from "../../extensions/skill-autocomplete.js";

const createCurrentProvider = (): AutocompleteProvider => ({
	async getSuggestions() {
		return {
			items: [{ value: "current", label: "current" }],
			prefix: "current",
		};
	},
	applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
		return {
			lines: [...lines.slice(0, cursorLine), `${lines[cursorLine]!.slice(0, cursorCol - prefix.length)}${item.value}`],
			cursorLine,
			cursorCol: cursorCol - prefix.length + item.value.length,
		};
	},
});

const dummyTui = {
	requestRender: vi.fn(),
	terminal: { rows: 24 },
} as never;

const dummyTheme = {
	borderColor: (value: string) => value,
	selectList: {
		selectedPrefix: (value: string) => value,
		selectedText: (value: string) => value,
		description: (value: string) => value,
		scrollInfo: (value: string) => value,
		noMatch: (value: string) => value,
	},
} as never;

describe("skill autocomplete token extraction", () => {
	it("extracts a skill token after a dollar sign at a word boundary", () => {
		expect(extractSkillToken("invoke $use-gh-cli")).toBe("use-gh-cli");
		expect(extractSkillToken("$")).toBe("");
		expect(extractSkillToken("$create-skill")).toBe("create-skill");
		expect(extractSkillToken("invoke skill $use test")).toBeUndefined();
		expect(extractSkillToken("invoke skill use-gh-cli")).toBeUndefined();
		expect(extractSkillToken("invoke x$use-gh-cli")).toBeUndefined();
	});

	it("decides when a printable key should re-open autocomplete live", () => {
		expect(shouldAutoTriggerSkillAutocomplete("$", "$")).toBe(true);
		expect(shouldAutoTriggerSkillAutocomplete("u", "$u")).toBe(true);
		expect(shouldAutoTriggerSkillAutocomplete(" ", "$u ")).toBe(false);
		expect(shouldAutoTriggerSkillAutocomplete("\n", "$u\n")).toBe(false);
		expect(shouldAutoTriggerSkillAutocomplete("\u001b", "$u")).toBe(false);
	});
});

describe("skill autocomplete filtering", () => {
	it("returns matching skill items with a dollar-prefixed value", () => {
		const items = filterSkills(["create-skill", "use-gh-cli", "use-test-driven-design"], "use-gh");

		expect(items).toHaveLength(1);
		expect(items[0]).toEqual({
			value: "$use-gh-cli",
			label: "$use-gh-cli",
			description: "Pi skill",
		});
	});
});

describe("skill autocomplete provider", () => {
	it("delegates to the current provider when no skill token is present", async () => {
		const current = createCurrentProvider();
		const getSkills = vi.fn(async () => ["create-skill", "use-gh-cli"]);
		const provider = createSkillAutocompleteProvider(current, getSkills);

		const result = await provider.getSuggestions(["hello world"], 0, 11, { signal: new AbortController().signal });

		expect(getSkills).not.toHaveBeenCalled();
		expect(result).toEqual({
			items: [{ value: "current", label: "current" }],
			prefix: "current",
		});
	});

	it("returns skill suggestions for matching $ tokens and falls back when there are no matches", async () => {
		const current = createCurrentProvider();
		const getSkills = vi.fn(async () => ["create-skill", "use-gh-cli", "use-test-driven-design"]);
		const provider = createSkillAutocompleteProvider(current, getSkills);

		const bareToken = (await provider.getSuggestions(["try $"], 0, 5, {
			signal: new AbortController().signal,
		})) as AutocompleteSuggestions;

		expect(bareToken.items).toHaveLength(3);
		expect(bareToken.prefix).toBe("$");

		const result = (await provider.getSuggestions(["try $use-gh"], 0, 11, {
			signal: new AbortController().signal,
		})) as AutocompleteSuggestions;

		expect(result).toEqual({
			prefix: "$use-gh",
			items: [
				{
					value: "$use-gh-cli",
					label: "$use-gh-cli",
					description: "Pi skill",
				},
			],
		});

		const fallback = await provider.getSuggestions(["try $unknown"], 0, 12, {
			signal: new AbortController().signal,
		});

		expect(fallback).toEqual({
			items: [{ value: "current", label: "current" }],
			prefix: "current",
		});
	});
});

describe("skill autocomplete editor", () => {
	it("re-opens autocomplete while typing a skill token", () => {
		const editor = new SkillAutocompleteEditor(dummyTui, dummyTheme);
		const triggerSpy = vi.spyOn(editor as unknown as { tryTriggerAutocomplete: () => void }, "tryTriggerAutocomplete");

		editor.setText("try ");
		editor.handleInput("$");
		expect(triggerSpy).toHaveBeenCalledTimes(1);

		triggerSpy.mockClear();
		editor.handleInput("u");
		expect(triggerSpy).toHaveBeenCalledTimes(1);

		triggerSpy.mockClear();
		editor.handleInput(" ");
		expect(triggerSpy).not.toHaveBeenCalled();
	});
});

describe("skill autocomplete extension", () => {
	it("registers a stacked autocomplete provider and editor override on session start", async () => {
		const handlers = new Map<string, (event: unknown, ctx: ExtensionContext) => Promise<void> | void>();
		const addAutocompleteProvider = vi.fn();
		const setEditorComponent = vi.fn();
		const pi = {
			on: vi.fn((event: string, handler: (event: unknown, ctx: ExtensionContext) => Promise<void> | void) => {
				handlers.set(event, handler);
			}),
		} as unknown as ExtensionAPI;

		createSkillAutocompleteExtension(async () => ["create-skill"])(pi);

		const ctx = {
			cwd: "/tmp/repo",
			ui: {
				addAutocompleteProvider,
				setEditorComponent,
			},
		} as unknown as ExtensionContext;

		await handlers.get("session_start")!({ type: "session_start", reason: "new" }, ctx);

		expect(addAutocompleteProvider).toHaveBeenCalledTimes(1);
		expect(typeof addAutocompleteProvider.mock.calls[0]![0]).toBe("function");
		expect(setEditorComponent).toHaveBeenCalledTimes(1);
		expect(typeof setEditorComponent.mock.calls[0]![0]).toBe("function");
	});
});
