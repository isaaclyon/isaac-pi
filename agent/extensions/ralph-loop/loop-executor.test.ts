import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executeLoopWithTmux, readOutputLinesForTests } from "./loop-executor.js";
import type { RalphRunConfig } from "./types.js";

function config(): RalphRunConfig {
	return {
		task: "Implement feature",
		maxLoops: 3,
		budget: { contextThresholdPercent: 50, maxAssistantTurns: 10, maxToolCalls: 20 },
		success: { mode: "quantitative", checks: [{ command: "echo ok" }] },
		runner: { cwd: ".", model: null, tools: null, tmuxSessionPrefix: "ralph", modelContextWindowTokens: 100_000 },
	};
}

describe("executeLoopWithTmux", () => {
	it("stops session when context threshold trigger is hit", async () => {
		const startSession = vi.fn(async () => undefined);
		const hasSession = vi
			.fn<() => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const stopSession = vi.fn(async () => undefined);
		const wait = vi.fn(async () => undefined);
		const readOutput = vi
			.fn<(path: string, fromLine: number) => Promise<{ lines: string[]; nextLine: number }>>()
			.mockResolvedValueOnce({
				lines: [
					JSON.stringify({
						type: "message_end",
						message: {
							role: "assistant",
							usage: { totalTokens: 60_000 },
							content: [{ type: "text", text: "progress" }],
						},
					}),
				],
				nextLine: 1,
			})
			.mockResolvedValue({ lines: [], nextLine: 1 });

		const result = await executeLoopWithTmux({
			runId: "run_123",
			loopNumber: 1,
			config: config(),
			previousCheckpoint: null,
			modelContextWindowTokens: 100_000,
			deps: {
				startSession,
				hasSession,
				stopSession,
				readOutput,
				wait,
			},
		});

		expect(startSession).toHaveBeenCalledTimes(1);
		expect(stopSession).toHaveBeenCalledTimes(1);
		expect(result.triggerReason).toBe("context_threshold");
		expect(result.state).toBe("completed");
		expect(result.summary).toContain("assistantTurns=1");
	});

	it("marks loop failed when child assistant reports stopReason=error", async () => {
		const startSession = vi.fn(async () => undefined);
		const hasSession = vi
			.fn<() => Promise<boolean>>()
			.mockResolvedValueOnce(true)
			.mockResolvedValueOnce(false);
		const stopSession = vi.fn(async () => undefined);
		const wait = vi.fn(async () => undefined);
		const readOutput = vi
			.fn<(path: string, fromLine: number) => Promise<{ lines: string[]; nextLine: number }>>()
			.mockResolvedValueOnce({
				lines: [
					JSON.stringify({
						type: "message_end",
						message: {
							role: "assistant",
							stopReason: "error",
							errorMessage: "provider failure",
							usage: { totalTokens: 20_000 },
							content: [{ type: "text", text: "failed" }],
						},
					}),
				],
				nextLine: 1,
			})
			.mockResolvedValue({ lines: [], nextLine: 1 });

		const result = await executeLoopWithTmux({
			runId: "run_123",
			loopNumber: 1,
			config: config(),
			previousCheckpoint: null,
			modelContextWindowTokens: 100_000,
			deps: {
				startSession,
				hasSession,
				stopSession,
				readOutput,
				wait,
			},
		});

		expect(result.state).toBe("failed");
		expect(result.triggerReason).toBe("child_execution_failed");
		expect(result.summary).toContain("provider failure");
	});

	it("stops tmux session immediately when abort signal is triggered", async () => {
		const controller = new AbortController();
		const startSession = vi.fn(async () => {
			controller.abort();
		});
		const hasSession = vi.fn<() => Promise<boolean>>().mockResolvedValueOnce(true).mockResolvedValueOnce(false);
		const stopSession = vi.fn(async () => undefined);
		const wait = vi.fn(async () => undefined);
		const readOutput = vi.fn<(path: string, fromLine: number) => Promise<{ lines: string[]; nextLine: number }>>().mockResolvedValue({ lines: [], nextLine: 0 });

		const result = await executeLoopWithTmux({
			runId: "run_123",
			loopNumber: 1,
			config: config(),
			previousCheckpoint: null,
			modelContextWindowTokens: 100_000,
			signal: controller.signal,
			deps: {
				startSession,
				hasSession,
				stopSession,
				readOutput,
				wait,
			},
		});

		expect(stopSession).toHaveBeenCalledTimes(1);
		expect(result.state).toBe("stopped");
		expect(result.triggerReason).toBe("operator_stop");
	});

	it("advances cursor by raw lines even when blank lines are filtered", async () => {
		const dir = mkdtempSync(join(tmpdir(), "ralph-loop-lines-"));
		const filePath = join(dir, "out.jsonl");
		writeFileSync(filePath, "line-1\n\nline-3\n", "utf8");

		const first = await readOutputLinesForTests(filePath, 0);
		expect(first.lines).toEqual(["line-1", "line-3"]);
		expect(first.nextLine).toBe(3);

		rmSync(dir, { recursive: true, force: true });
	});
});
