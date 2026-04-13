import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../..");
const builtinAgentsRoot = "/Users/isaaclyon/.local/share/fnm/node-versions/v22.22.0/installation/lib/node_modules/pi-subagents/agents";
const userAgentsRoot = path.join(repoRoot, "agent/agents");

const expectedAgents = {
	scout: { model: "openai-codex/gpt-5.4-mini", thinking: "medium" },
	planner: { model: "openai-codex/gpt-5.4", thinking: "high" },
	worker: { model: "openai-codex/gpt-5.4", thinking: "medium" },
	reviewer: { model: "openai-codex/gpt-5.4", thinking: "high" },
	"context-builder": { model: "openai-codex/gpt-5.4", thinking: "medium" },
	researcher: { model: "openai-codex/gpt-5.4", thinking: "medium" },
	delegate: { model: null, thinking: null },
} as const;

function readFile(filePath: string): string {
	return readFileSync(filePath, "utf8");
}

function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
	const match = markdown.match(/^---\n([\s\S]*?)\n---\n\n?([\s\S]*)$/);
	if (!match) {
		throw new Error("Missing YAML frontmatter");
	}
	return {
		frontmatter: match[1],
		body: match[2],
	};
}

function getFrontmatterValue(frontmatter: string, key: string): string | null {
	const match = frontmatter.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
	return match ? match[1].trim() : null;
}

describe("OpenAI global subagent overrides", () => {
	for (const [name, expected] of Object.entries(expectedAgents)) {
		it(`defines ${name} with the expected OpenAI model mapping`, () => {
			const builtin = splitFrontmatter(readFile(path.join(builtinAgentsRoot, `${name}.md`)));
			const override = splitFrontmatter(readFile(path.join(userAgentsRoot, `${name}.md`)));

			expect(override.body).toBe(builtin.body);
			expect(getFrontmatterValue(override.frontmatter, "name")).toBe(name);
			expect(getFrontmatterValue(override.frontmatter, "description")).toBe(
				getFrontmatterValue(builtin.frontmatter, "description"),
			);

			if (expected.model === null) {
				expect(getFrontmatterValue(override.frontmatter, "model")).toBeNull();
			} else {
				expect(getFrontmatterValue(override.frontmatter, "model")).toBe(expected.model);
			}

			if (expected.thinking === null) {
				expect(getFrontmatterValue(override.frontmatter, "thinking")).toBeNull();
			} else {
				expect(getFrontmatterValue(override.frontmatter, "thinking")).toBe(expected.thinking);
			}
		});
	}
});
