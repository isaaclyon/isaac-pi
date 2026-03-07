import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveRalphConfig } from "./config.js";

describe("ralph-loop config", () => {
	afterEach(() => {
		delete process.env.PI_RALPH_ENABLED;
		delete process.env.PI_RALPH_DB_PATH;
		delete process.env.PI_RALPH_CONTEXT_THRESHOLD_PERCENT;
		delete process.env.PI_RALPH_MAX_ASSISTANT_TURNS;
		delete process.env.PI_RALPH_MAX_TOOL_CALLS;
		delete process.env.PI_RALPH_MODEL;
	});

	it("reads project config and applies sane defaults", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ralph-config-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(
			join(cwd, ".pi", "ralph-loop.json"),
			JSON.stringify({
				enabled: true,
				dbPath: join(cwd, ".pi", "ralph.db"),
				defaultRun: {
					task: "Ship feature",
					maxLoops: 3,
					budget: { contextThresholdPercent: 40, maxAssistantTurns: 4, maxToolCalls: 20 },
					runner: { cwd: ".", tmuxSessionPrefix: "ralphy", tools: ["read", "bash"] },
					success: { mode: "deterministic-tdd", mustFail: ["pytest tests/fail.py"], mustPass: ["pytest tests/pass.py"] },
				},
			}),
			"utf8",
		);

		const config = resolveRalphConfig(cwd);
		expect(config.enabled).toBe(true);
		expect(config.dbPath).toContain("ralph.db");
		expect(config.defaultRun.maxLoops).toBe(3);
		expect(config.defaultRun.budget.contextThresholdPercent).toBe(40);
		expect(config.defaultRun.runner.tmuxSessionPrefix).toBe("ralphy");
		expect(config.defaultRun.success.mode).toBe("deterministic-tdd");

		rmSync(cwd, { recursive: true, force: true });
	});

	it("lets env override threshold and caps", () => {
		const cwd = mkdtempSync(join(tmpdir(), "ralph-config-env-"));
		process.env.PI_RALPH_CONTEXT_THRESHOLD_PERCENT = "55";
		process.env.PI_RALPH_MAX_ASSISTANT_TURNS = "6";
		process.env.PI_RALPH_MAX_TOOL_CALLS = "12";
		process.env.PI_RALPH_ENABLED = "true";

		const config = resolveRalphConfig(cwd);
		expect(config.enabled).toBe(true);
		expect(config.defaultRun.budget.contextThresholdPercent).toBe(55);
		expect(config.defaultRun.budget.maxAssistantTurns).toBe(6);
		expect(config.defaultRun.budget.maxToolCalls).toBe(12);

		rmSync(cwd, { recursive: true, force: true });
	});
});
