import { describe, expect, it } from "vitest";
import { buildSessionName, buildPiCommand } from "./tmux.js";

describe("tmux helpers", () => {
	it("builds deterministic session names", () => {
		const session = buildSessionName({ prefix: "ralph", runId: "run_1234567890", loopNumber: 3 });
		expect(session).toBe("ralph-run-123456-03");
	});

	it("builds child pi command with json mode and no session", () => {
		const command = buildPiCommand({
			task: "Ship parser",
			model: "anthropic/claude-sonnet-4-6",
			tools: ["read", "bash"],
			appendSystemPrompt: "System guidance",
			outputPath: "/tmp/ralph-loop-1.jsonl",
		});

		expect(command).toContain("'pi' '--mode' 'json' '-p' '--no-session'");
		expect(command).toContain("'--model' 'anthropic/claude-sonnet-4-6'");
		expect(command).toContain("'--tools' 'read,bash'");
		expect(command).toContain("'Task: Ship parser'");
		expect(command).toContain("> '/tmp/ralph-loop-1.jsonl' 2>&1");
	});

	it("shell-escapes output redirection path", () => {
		const command = buildPiCommand({
			task: "Ship parser",
			model: null,
			tools: null,
			outputPath: "/tmp/ralph loop; rm -rf /.jsonl",
		});

		expect(command).toContain("> '/tmp/ralph loop; rm -rf /.jsonl' 2>&1");
	});
});
