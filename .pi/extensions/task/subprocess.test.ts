import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	emptyUsage,
	mapWithConcurrency,
	placeholderResult,
	resolveTaskConfig,
	runSingleTask,
} from "./subprocess.js";
import type { TaskWorkItem } from "./types.js";

import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

interface FakeStream extends PassThrough {
	emitData(value: string | Buffer): void;
}

interface FakeChild extends EventEmitter {
	pid: number;
	stdin: { end: () => void };
	stdout: FakeStream;
	stderr: FakeStream;	unref: () => void;
	kill: (signal: NodeJS.Signals) => void;
}

const makeStream = (): FakeStream => {
	const stream = new PassThrough() as FakeStream;
	stream.emitData = (value: string | Buffer) => {
		stream.write(value);
	};
	return stream;
};

let nextSpawn: (() => FakeChild) | undefined;

vi.mock("node:child_process", () => ({
	spawn: () => {
		if (!nextSpawn) {
			throw new Error("no spawn handler configured");
		}
		const spawnChild = nextSpawn();
		nextSpawn = undefined;
		return spawnChild;
	},
}));

describe("subprocess helpers", () => {
	it("emptyUsage returns zeros", () => {
		expect(emptyUsage()).toEqual({
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 0,
		});
	});

	it("placeholderResult builds consistent defaults", () => {
		const placeholder = placeholderResult(
			{ prompt: "prompt", name: "job" },
			2,
			"high",
			"model-a",
			99,
		);
		expect(placeholder.exitCode).toBe(99);
		expect(placeholder.name).toBe("job");
		expect(placeholder.prompt).toBe("prompt");
		expect(placeholder.thinking).toBe("high");
		expect(placeholder.model).toBe("model-a");
		expect(placeholder.toolCalls).toEqual([]);
	});

	it("resolves task config with defaults and resolved model", () => {
		const config = resolveTaskConfig({
			item: { prompt: "do" },
			defaultModel: undefined,
			defaultThinking: "inherit",
			defaultTimeout: 33,
			inheritedThinking: "medium",
			ctxModel: { provider: "openai", id: "gpt-4o" },
			builtInTools: ["read", "bash"],
		});
		expect(config.ok).toBe(true);
		if (!config.ok) return;
		expect(config.subprocessArgs).toContain("--provider");
		expect(config.subprocessArgs).toContain("openai");
		expect(config.subprocessArgs).toContain("--thinking");
		expect(config.subprocessArgs).toContain("medium");
		expect(config.subprocessArgs).toContain("--tools");
		expect(config.subprocessArgs).toContain("read,bash");
		expect(config.timeout).toBe(33);
		expect(config.modelLabel).toBe("openai/gpt-4o");
	});

	it("resolves model errors from invalid item model strings", () => {
		const item: TaskWorkItem = {
			prompt: "do",
			model: "bad model",
		};
		const config = resolveTaskConfig({
			item,
			defaultModel: undefined,
			defaultThinking: "inherit",
			defaultTimeout: undefined,
			inheritedThinking: "low",
			ctxModel: { provider: "openai", id: "gpt" },
			builtInTools: [],
		});
		expect(config.ok).toBe(false);
		if (!config.ok) {
			expect(config.error).toContain('Invalid model format: "bad model". Expected provider/modelId.');
		}
	});
});

describe("mapWithConcurrency", () => {
	it("limits concurrency and preserves order", async () => {
		let active = 0;
		let maxActive = 0;

		const result = await mapWithConcurrency(["a", "b", "c", "d"], 2, async (item, index) => {
			active += 1;
			maxActive = Math.max(maxActive, active);
			await new Promise((resolve) => {
				setTimeout(resolve, 10);
			});
			active -= 1;
			return `${item}-${index}`;
		});

		expect(result).toEqual(["a-0", "b-1", "c-2", "d-3"]);
		expect(maxActive).toBeLessThanOrEqual(2);
	});

	it("handles empty input without calling mapper", async () => {
		const mapper = vi.fn(async () => "nope");
		const result = await mapWithConcurrency([], 3, mapper);
		expect(result).toEqual([]);
		expect(mapper).not.toHaveBeenCalled();
	});
});

describe("runSingleTask", () => {
	const mkChild = (): FakeChild => {
		const stdout = makeStream();
		const stderr = makeStream();
		const cp = new EventEmitter() as FakeChild;
		cp.pid = 999;
		cp.stdin = { end: vi.fn() };
		cp.stdout = stdout;
		cp.stderr = stderr;
		cp.unref = vi.fn();
		cp.kill = vi.fn((signal: NodeJS.Signals) => {
			if (signal === "SIGTERM") {
				setTimeout(() => cp.emit("close", 1), 0);
			}
		});
		return cp;
	};

	beforeEach(() => {
		nextSpawn = undefined;
	});

	it("runs successful child process and parses JSON messages", async () => {
		nextSpawn = () => {
			const cp = mkChild();
			setTimeout(() => {
				cp.stdout.emitData(
					'{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"done"}],"usage":{"input":1,"output":2,"cacheRead":3,"cacheWrite":4,"cost":{"total":0.42},"totalTokens":123}}}',
				);
				cp.emit("close", 0);
			}, 0);
			return cp;
		};

		const result = await runSingleTask({
			cwd: "/repo",
			item: { prompt: "work" },
			subprocessPrompt: "PROMPT",
			index: undefined,
			subprocessArgs: ["--mode", "json"],
			modelLabel: "openai/gpt",
			thinking: "medium",
			timeout: undefined,
			signal: undefined,
		});

		expect(result.exitCode).toBe(0);
		expect(result.messages).toHaveLength(1);
		expect(result.messages[0]?.role).toBe("assistant");
		expect(result.usage.input).toBe(1);
		expect(result.usage.output).toBe(2);
		expect(result.usage.contextTokens).toBe(123);
		expect(result.stopReason).toBeUndefined();
	});

	it("handles spawn errors by recording failure", async () => {
		nextSpawn = () => {
			const cp = mkChild();
			setTimeout(() => {
				cp.emit("error", new Error("boom"));
			}, 0);
			return cp;
		};

		const result = await runSingleTask({
			cwd: "/repo",
			item: { prompt: "work" },
			subprocessPrompt: "PROMPT",
			index: 1,
			subprocessArgs: ["--mode", "json"],
			modelLabel: "openai/gpt",
			thinking: "medium",
			timeout: undefined,
			signal: undefined,
		});

		expect(result.exitCode).toBe(1);
		expect(result.stopReason).toBe("error");
		expect(result.errorMessage).toBe("boom");
		expect(result.failure?.source).toBe("spawn_error");
	});

	it("respects timeout and marks timeout reason", async () => {
		vi.useFakeTimers();
		nextSpawn = () => {
			const cp = mkChild();
			setTimeout(() => {
				// process stays alive; timed-out path should force failure when test closes it.
				cp.emit("close", 0);
			}, 25);
			return cp;
		};

		const running = runSingleTask({
			cwd: "/repo",
			item: { prompt: "work" },
			subprocessPrompt: "PROMPT",
			index: undefined,
			subprocessArgs: ["--mode", "json"],
			modelLabel: "openai/gpt",
			thinking: "medium",
			timeout: 0.01,
			signal: undefined,
		});

		await vi.advanceTimersByTimeAsync(20);
		const result = await running;
		expect(result.stopReason).toBe("timeout");
		expect(result.errorMessage).toBe("Task timed out after 0.01s");
		vi.useRealTimers();
	});
});
