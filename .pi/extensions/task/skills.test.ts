import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	buildSubprocessPrompt,
	formatAvailableSkills,
	loadSkillDiscovery,
} from "./skills.js";
import { readFileSync } from "node:fs";

const mockSkill: { name: string; source: string; filePath: string; baseDir: string } = {
	name: "my-skill",
	source: "local",
	filePath: "/tmp/skills/my-skill/README.md",
	baseDir: "/tmp/skills/my-skill",
};

vi.mock("@mariozechner/pi-coding-agent", async () => {
	const actual = await vi.importActual<typeof import("@mariozechner/pi-coding-agent")>("@mariozechner/pi-coding-agent");
	const getSkillPaths = vi.fn(() => ["/tmp/skills"]);
	return {
		...actual,
		SettingsManager: {
			create: () => ({ getSkillPaths }),
		},
		loadSkills: vi.fn(() => ({
			skills: [
				{
					name: mockSkill.name,
					source: mockSkill.source,
					filePath: mockSkill.filePath,
					baseDir: mockSkill.baseDir,
				},
			],
		})),
	};
});

vi.mock("node:fs", async () => {
	const actual = await vi.importActual("node:fs");
	return {
		...actual,
		readFileSync: vi.fn(),
	};
});

describe("loadSkillDiscovery", () => {
	it("indexes discovered skills by name", () => {
		const state = loadSkillDiscovery("/repo");

		expect(state.skills).toEqual([
			{
				name: mockSkill.name,
				source: mockSkill.source,
				filePath: mockSkill.filePath,
				baseDir: mockSkill.baseDir,
			},
		]);
		expect(state.byName.get(mockSkill.name)?.name).toBe(mockSkill.name);
		expect(state.baseCache instanceof Map).toBe(true);
	});
});

describe("formatAvailableSkills", () => {
	it("formats full list and remaining count", () => {
		const out = formatAvailableSkills(
			[
				{ name: "a", source: "s1", filePath: "", baseDir: "" },
				{ name: "b", source: "s2", filePath: "", baseDir: "" },
				{ name: "c", source: "s3", filePath: "", baseDir: "" },
		],
			2,
		);
		expect(out).toEqual({
			text: "a (s1), b (s2)",
			remaining: 1,
		});
	});

	it("returns none when no skills", () => {
		expect(formatAvailableSkills([], 5)).toEqual({ text: "none", remaining: 0 });
	});
});

describe("buildSubprocessPrompt", () => {
	beforeEach(() => {
		vi.mocked(readFileSync).mockReset();
	});

	it("returns original prompt when no skill is set", () => {
		const state = loadSkillDiscovery("/repo");
		const result = buildSubprocessPrompt(
			{ prompt: "Do work", skill: undefined },
			state,
			10,
		);
		expect(result).toEqual({ ok: true, prompt: "Do work" });
	});

	it("returns clear error for unknown skill and includes extra availability", () => {
		const state = loadSkillDiscovery("/repo");
		const result = buildSubprocessPrompt({ prompt: "x", skill: "missing" }, state, 1);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch("Unknown skill: missing");
			expect(result.error).toContain("Available skills: my-skill (local)");
		}
	});

	it("loads and prefixes skill base once, then reuses cache", () => {
		const state = loadSkillDiscovery("/repo");
		vi.mocked(readFileSync).mockReturnValue("---\nname: demo\n---\nBody content");

		const first = buildSubprocessPrompt(
			{ prompt: "Run tests", skill: mockSkill.name, name: "task" },
			state,
			10,
		);
		expect(first.ok).toBe(true);
		expect(first).toEqual({
			ok: true,
			prompt:
				`Skill location: ${mockSkill.filePath}\n` +
				`References are relative to ${mockSkill.baseDir}.\n\nBody content\n\n---\n\nUser: Run tests`,
		});

		const second = buildSubprocessPrompt(
			{ prompt: "Again", skill: mockSkill.name },
			state,
			10,
		);
		expect(second).toEqual({
			ok: true,
			prompt:
				`Skill location: ${mockSkill.filePath}\n` +
				`References are relative to ${mockSkill.baseDir}.\n\nBody content\n\n---\n\nUser: Again`,
		});
		expect(readFileSync).toHaveBeenCalledTimes(1);
	});

	it("returns a useful error when skill body is unreadable", () => {
		const state = loadSkillDiscovery("/repo");
		vi.mocked(readFileSync).mockImplementation(() => {
			throw new Error("boom");
		});

		const result = buildSubprocessPrompt({ prompt: "oops", skill: mockSkill.name }, state, 10);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toMatch("Failed to load skill \"my-skill\": boom");
		}
	});
});
