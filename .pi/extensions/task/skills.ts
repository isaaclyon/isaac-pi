/**
 * Skill discovery and prompt building for the task tool.
 */

import * as fs from "node:fs";
import {
	loadSkills,
	SettingsManager,
	type Skill,
} from "@mariozechner/pi-coding-agent";
import type { TaskWorkItem } from "./types.js";

// ---------------------------------------------------------------------------
// Skill state
// ---------------------------------------------------------------------------

export interface SkillState {
	skills: Skill[];
	byName: Map<string, Skill>;
	baseCache: Map<string, string>;
}

export function loadSkillDiscovery(cwd: string): SkillState {
	const settings = SettingsManager.create(cwd);
	const paths = settings.getSkillPaths();
	const { skills } = loadSkills({ cwd, skillPaths: paths });
	const byName = new Map<string, Skill>();
	for (const skill of skills) byName.set(skill.name, skill);
	return { skills, byName, baseCache: new Map() };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function formatAvailableSkills(
	skills: Skill[],
	limit: number,
): { text: string; remaining: number } {
	if (skills.length === 0) return { text: "none", remaining: 0 };
	const listed = skills.slice(0, limit);
	const remaining = skills.length - listed.length;
	return {
		text: listed.map((s) => `${s.name} (${s.source})`).join(", "),
		remaining,
	};
}

// ---------------------------------------------------------------------------
// Skill prompt building
// ---------------------------------------------------------------------------

function stripYamlFrontmatter(content: string): string {
	return content
		.replace(/\r\n/g, "\n")
		.replace(/\r/g, "\n")
		.replace(/^---\n[\s\S]*?\n---\n/, "")
		.trim();
}

function buildSkillBase(skill: Skill): string {
	const content = fs.readFileSync(skill.filePath, "utf-8");
	const body = stripYamlFrontmatter(content);
	const header = `Skill location: ${skill.filePath}\nReferences are relative to ${skill.baseDir}.`;
	return `${header}\n\n${body}`;
}

export function buildSubprocessPrompt(
	item: TaskWorkItem,
	state: SkillState,
	skillListLimit: number,
): { ok: true; prompt: string } | { ok: false; error: string } {
	if (!item.skill) return { ok: true, prompt: item.prompt };

	const skill = state.byName.get(item.skill);
	if (!skill) {
		const available = formatAvailableSkills(state.skills, skillListLimit);
		const suffix =
			available.remaining > 0 ? `, ... +${available.remaining} more` : "";
		return {
			ok: false,
			error: `Unknown skill: ${item.skill}\nAvailable skills: ${available.text}${suffix}`,
		};
	}

	let base = state.baseCache.get(skill.name);
	if (!base) {
		try {
			base = buildSkillBase(skill);
			state.baseCache.set(skill.name, base);
		} catch (err) {
			return {
				ok: false,
				error: `Failed to load skill "${skill.name}": ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	return { ok: true, prompt: `${base}\n\n---\n\nUser: ${item.prompt}` };
}
