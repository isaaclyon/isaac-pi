import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	Editor,
	type AutocompleteItem,
	type AutocompleteProvider,
	type AutocompleteSuggestions,
	type EditorTheme,
	fuzzyFilter,
} from "@mariozechner/pi-tui";

const MAX_SUGGESTIONS = 20;
const SKILL_TOKEN_RE = /(?:^|[ \t])\$([A-Za-z0-9_-]*)$/;
const DEFAULT_SKILLS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "skills");

type SkillAutocompleteTrigger = {
	tryTriggerAutocomplete: (explicitTab?: boolean) => void;
};

export function extractSkillToken(textBeforeCursor: string): string | undefined {
	const match = textBeforeCursor.match(SKILL_TOKEN_RE);
	return match?.[1];
}

export function shouldAutoTriggerSkillAutocomplete(data: string, textBeforeCursor: string): boolean {
	return data.length === 1 && data.charCodeAt(0) >= 32 && extractSkillToken(textBeforeCursor) !== undefined;
}

export class SkillAutocompleteEditor extends Editor {
	override handleInput(data: string): void {
		super.handleInput(data);
		if (this.isShowingAutocomplete()) {
			return;
		}

		const cursor = this.getCursor();
		const currentLine = this.getLines()[cursor.line] ?? "";
		const textBeforeCursor = currentLine.slice(0, cursor.col);
		if (!shouldAutoTriggerSkillAutocomplete(data, textBeforeCursor)) {
			return;
		}

		(this as unknown as SkillAutocompleteTrigger).tryTriggerAutocomplete();
	}
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}
	return String(error);
}

function normalizeSkillNames(skillNames: string[]): string[] {
	return [...new Set(skillNames)].sort((left, right) => left.localeCompare(right));
}

export function formatSkillItem(skillName: string): AutocompleteItem {
	return {
		value: `$${skillName}`,
		label: `$${skillName}`,
		description: "Pi skill",
	};
}

export function filterSkills(skillNames: string[], query: string): AutocompleteItem[] {
	const normalizedQuery = query.trim();
	const normalizedSkills = normalizeSkillNames(skillNames);

	if (normalizedQuery.length === 0) {
		return normalizedSkills.slice(0, MAX_SUGGESTIONS).map(formatSkillItem);
	}

	return fuzzyFilter(normalizedSkills, normalizedQuery, (skillName) => skillName)
		.slice(0, MAX_SUGGESTIONS)
		.map(formatSkillItem);
}

export async function loadSkillNamesFromDirectory(skillsDir: string): Promise<string[]> {
	const entries = await fs.readdir(skillsDir, { withFileTypes: true });
	return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

export function createSkillAutocompleteProvider(
	current: AutocompleteProvider,
	getSkills: () => Promise<string[]>,
): AutocompleteProvider {
	return {
		async getSuggestions(lines, cursorLine, cursorCol, options): Promise<AutocompleteSuggestions | null> {
			const currentLine = lines[cursorLine] ?? "";
			const textBeforeCursor = currentLine.slice(0, cursorCol);
			const token = extractSkillToken(textBeforeCursor);
			if (token === undefined) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const skills = await getSkills();
			if (options.signal.aborted || skills.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			const suggestions = filterSkills(skills, token);
			if (suggestions.length === 0) {
				return current.getSuggestions(lines, cursorLine, cursorCol, options);
			}

			return {
				items: suggestions,
				prefix: `$${token}`,
			};
		},

		applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
			return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
		},

		shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
			return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
		},
	};
}

export function createSkillAutocompleteExtension(getSkills: () => Promise<string[]>): (pi: ExtensionAPI) => void {
	return (pi: ExtensionAPI): void => {
		pi.on("session_start", async (_event, ctx) => {
			let skillsPromise: Promise<string[]> | undefined;
			let loadErrorShown = false;

			const resolveSkills = async (): Promise<string[]> => {
				skillsPromise ||= (async () => {
					try {
						return await getSkills();
					} catch (error) {
						if (!loadErrorShown) {
							loadErrorShown = true;
							ctx.ui.notify(`skill-autocomplete: failed to load skills: ${formatError(error)}`, "error");
						}
						return [];
					}
				})();
				return skillsPromise;
			};

			void resolveSkills();
			ctx.ui.setEditorComponent((tui, theme: EditorTheme) => new SkillAutocompleteEditor(tui, theme));
			ctx.ui.addAutocompleteProvider((current) => createSkillAutocompleteProvider(current, resolveSkills));
		});
	};
}

export default function skillAutocompleteExtension(pi: ExtensionAPI): void {
	createSkillAutocompleteExtension(() => loadSkillNamesFromDirectory(DEFAULT_SKILLS_DIR))(pi);
}
