/**
 * Skill dispatch extension.
 *
 * Registers `$skillname` prefix commands for every skill found in
 * `.pi/skills/` (project) and `~/.pi/agent/skills/` (global).
 *
 * Typing `$changelog-generator summarize this` expands to
 * `/skill:changelog-generator summarize this` so the agent reads the full
 * SKILL.md content and runs with that context.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { homedir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { Dirent, readdirSync, readFileSync } from "node:fs";

interface SkillInfo {
	name: string;
	description: string;
}

/** Parse YAML-like frontmatter for just the keys we need. */
function parseFrontmatter(content: string): Record<string, string> {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
	if (!match?.[1]) return {};

	const result: Record<string, string> = {};
	const lines = match[1].split(/\r?\n/);

	let i = 0;
	while (i < lines.length) {
		const line = lines[i] ?? "";
		const matchLine = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
		if (!matchLine) {
			i++;
			continue;
		}

		const key = matchLine[1];
		let value = matchLine[2].trim();
		if ((value === ">" || value === "|") && i + 1 < lines.length) {
			i++;
			const blockLines: string[] = [];
			while (i < lines.length) {
				const next = lines[i] ?? "";
				if (!/^[ \t]/.test(next)) {
					break;
				}
				const cleaned = next.trim();
				if (cleaned.length > 0) {
					blockLines.push(cleaned);
				}
				i++;
			}
			value = blockLines.join(" ").replace(/\s+/g, " ").trim();
			result[key] = value;
			continue;
		}

		while (i + 1 < lines.length) {
			const next = lines[i + 1] ?? "";
			if (!/^[ \t]/.test(next)) {
				break;
			}
			i++;
			const trimmed = next.trim();
			if (trimmed.length > 0) {
				value = value ? `${value} ${trimmed}` : trimmed;
			}
		}

		result[key] = value.replace(/^"|"$/g, "").replace(/^'|'$/g, "");
		i++;
	}

	return result;
}

function getSkillNameFromPath(filePath: string): string {
	const filename = basename(filePath);
	const base = filename.endsWith(extname(filePath)) ? basename(filePath, extname(filePath)) : filename;
	if (base.toLowerCase() !== "skill") {
		return base;
	}
	return basename(dirname(filePath));
}

function collectSkillFiles(dir: string): string[] {
	const files: string[] = [];
	const walk = (currentDir: string, isRoot: boolean): void => {
		let entries: Dirent[];
		try {
			entries = readdirSync(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (entry.name.startsWith(".")) {
				continue;
			}
			const fullPath = join(currentDir, entry.name);
			if (entry.isDirectory()) {
				walk(fullPath, false);
				continue;
			}
			if (!entry.isFile()) {
				continue;
			}
			if (isRoot && entry.name.toLowerCase().endsWith(".md")) {
				files.push(fullPath);
				continue;
			}
			if (!isRoot && entry.name === "SKILL.md") {
				files.push(fullPath);
			}
		}
	};

	walk(dir, true);
	return files;
}

function discoverSkills(dir: string): SkillInfo[] {
	const skills: SkillInfo[] = [];
	for (const filePath of collectSkillFiles(dir)) {
		try {
			const content = readFileSync(filePath, "utf-8");
			const fm = parseFrontmatter(content);
			const name = (fm["name"]?.trim() || getSkillNameFromPath(filePath)).trim();
			if (!name || /\s/.test(name)) continue;
			skills.push({
				name,
				description: fm["description"]?.trim() || `Run the ${name} skill`,
			});
		} catch {
			continue;
		}
	}
	return skills;
}

export default function skillDispatch(pi: ExtensionAPI): void {
	const cwd = process.cwd();
	const projectSkillsDir = resolve(cwd, ".pi/skills");
	const userSkillsDir = join(homedir(), ".pi", "agent", "skills");

	const skillMap = new Map<string, SkillInfo>();
	for (const skill of discoverSkills(userSkillsDir)) {
		skillMap.set(skill.name, skill);
	}
	for (const skill of discoverSkills(projectSkillsDir)) {
		skillMap.set(skill.name, skill);
	}

	const uniqueSkills = Array.from(skillMap.values()).sort((a, b) =>
		a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
	);

	for (const skill of uniqueSkills) {
		pi.registerPrefixCommand("$", skill.name, {
			description: skill.description || `Run the ${skill.name} skill`,
			handler: async (args, _ctx) => {
				const suffix = args.trim() ? ` ${args.trim()}` : "";
				pi.sendUserMessage(`/skill:${skill.name}${suffix}`);
			},
		});
	}

	if (uniqueSkills.length > 0) {
		pi.on("session_start", async (_event, ctx) => {
			const names = uniqueSkills.map((skill) => skill.name).join(", ");
			ctx.ui.setStatus("skill-dispatch", `$skills: ${names}`);
		});
	}
}
