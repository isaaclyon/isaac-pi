import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

const agentsDirectory = new URL("../agents/", import.meta.url);

function parseFrontmatter(fileName) {
	const content = readFileSync(new URL(fileName, agentsDirectory), "utf8");
	const frontmatter = content.match(/^---\n([\s\S]*?)\n---/u)?.[1];
	assert.ok(frontmatter, `${fileName} must have frontmatter`);

	return new Map(
		frontmatter.split("\n").map((line) => {
			const separator = line.indexOf(":");
			assert.notEqual(separator, -1, `${fileName} has malformed frontmatter: ${line}`);
			return [line.slice(0, separator), line.slice(separator + 1).trim()];
		}),
	);
}

test("GPT-5.6 agents with shell access allow Code Mode execution tools", () => {
	for (const fileName of readdirSync(agentsDirectory).filter((name) => name.endsWith(".md"))) {
		const frontmatter = parseFrontmatter(fileName);
		if (!frontmatter.get("model")?.startsWith("openai-codex/gpt-5.6")) continue;

		const tools = frontmatter
			.get("tools")
			?.split(",")
			.map((tool) => tool.trim());
		if (!tools?.some((tool) => tool === "exec" || tool === "exec_command")) continue;

		assert.ok(tools.includes("exec"), `${fileName} must allow the Code Mode exec tool`);
		assert.ok(tools.includes("wait"), `${fileName} must allow the Code Mode wait tool`);
		assert.ok(tools.includes("exec_command"), `${fileName} must allow the normal-mode exec_command tool`);
	}
});
