import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentToolUpdateCallback } from "@mariozechner/pi-coding-agent";
import type { ThinkingLevel } from "@mariozechner/pi-agent-core";

import type { SkillState } from "./skills.js";
import type { SingleResult, TaskWorkItem } from "./types.js";

vi.mock("./skills.js", async () => {
	const actual = await vi.importActual<typeof import("./skills.js")>("./skills.js");
	return {
		...actual,
		buildSubprocessPrompt: vi.fn(),
	};
});

vi.mock("./subprocess.js", async () => {
	const actual = await vi.importActual<typeof import("./subprocess.js")>("./subprocess.js");
	return {
		...actual,
		resolveTaskConfig: vi.fn(),
		runSingleTask: vi.fn(),
	};
});

import { buildSubprocessPrompt } from "./skills.js";
import { executeChain, executeParallel, executeSingle } from "./execute.js";
import {
	resolveTaskConfig,
	runSingleTask,
	type ResolvedConfig,
} from "./subprocess.js";

const state: SkillState = {
	skills: [],
	byName: new Map(),
	baseCache: new Map(),
};

const makeOkConfig = (
	overrides: Partial<ResolvedConfig> = {},
): { ok: true } & ResolvedConfig => ({
	ok: true,
	thinkingLevel: "low",
	subprocessArgs: ["--mode"],
	modelLabel: undefined,
	timeout: undefined,
	...overrides,
});

const makeContext = (
	onUpdate: AgentToolUpdateCallback | undefined = undefined,
) => ({
	cwd: "/repo",
	ctxModel: { provider: "openai", id: "gpt" },
	inheritedThinking: "low" as ThinkingLevel,
	builtInTools: ["read"] as Array<"read">,
	signal: undefined,
	onUpdate,
});

const getFirstText = (content: unknown): string => {
	if (!Array.isArray(content) || content.length === 0) return "";
	const first = content[0];
	if (!first || typeof first !== "object") return "";
	if ((first as { type?: unknown }).type !== "text") return "";
	const text = (first as { text?: unknown }).text;
	return typeof text === "string" ? text : "";
};

const makeResult = (params: {
	prompt: string;
	exitCode?: number;
	empty?: boolean;
	messageText?: string;
	errorMessage?: string;
	toolCallCommand?: string;
	skill?: string;
	index?: number;
}): SingleResult => {
	const parts: Array<Record<string, unknown>> = [];
	if (params.toolCallCommand) {
		parts.push({
			type: "toolCall",
			name: "bash",
			arguments: { command: params.toolCallCommand },
		});
	}

	if (!params.empty) {
		parts.push({ type: "text", text: params.messageText ?? "done" });
	}

	return {
		name: "task",
		prompt: params.prompt,
		index: params.index ?? 1,
		exitCode: params.exitCode ?? 0,
		messages: params.empty ? [] : ([{ role: "assistant", content: parts }] as never),
		errorMessage: params.errorMessage,
		stderr: "",
		rawStdout: "",
		usage: {
			input: 1,
			output: 2,
			cacheRead: 0,
			cacheWrite: 0,
			cost: 0,
			contextTokens: 0,
			turns: 1,
		},
		toolCalls: [],
		skill: params.skill,
	};
};

describe("executeSingle", () => {
	beforeEach(() => {
		vi.mocked(buildSubprocessPrompt).mockReset();
		vi.mocked(resolveTaskConfig).mockReset();
		vi.mocked(runSingleTask).mockReset();
	});

	it("returns prepare error when prompt construction fails", async () => {
		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: false, error: "bad item" });

		const result = await executeSingle(
			{ mode: "single", items: [{ prompt: "do" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe("bad item");
		expect(result.details.results).toHaveLength(0);
	});

	it("returns final text and emits running update", async () => {
		const updates: string[] = [];
		const onUpdate: AgentToolUpdateCallback = (payload) => {
			updates.push(getFirstText(payload.content));
		};

		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: true, prompt: "subprompt" });
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig({ modelLabel: "openai/gpt" }));
		vi.mocked(runSingleTask).mockResolvedValue(makeResult({ prompt: "do", messageText: "final" }));

		const result = await executeSingle(
			{ mode: "single", items: [{ prompt: "do" }], thinking: "inherit" },
			state,
			makeContext(onUpdate),
		);

		expect(getFirstText(result.content)).toBe("final");
		expect(updates).toEqual(["(running...)"]);
	});

	it("returns failed result if subprocess fails", async () => {
		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: true, prompt: "subprompt" });
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig({ modelLabel: "openai/gpt" }));
		vi.mocked(runSingleTask).mockResolvedValue(
			makeResult({ prompt: "do", exitCode: 1, errorMessage: "bad" }),
		);

		const result = await executeSingle(
			{ mode: "single", items: [{ prompt: "do" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe("Task failed: bad");
	});

	it("uses fallback text when task output is empty", async () => {
		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: true, prompt: "subprompt" });
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig({ modelLabel: "openai/gpt" }));
		vi.mocked(runSingleTask).mockResolvedValue(makeResult({ prompt: "do", empty: true }));

		const result = await executeSingle(
			{ mode: "single", items: [{ prompt: "do" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe("(no output)");
	});

	it("returns cwd validation error for an absolute task working directory", async () => {
		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: true, prompt: "subprompt" });
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig({ modelLabel: "openai/gpt" }));

		const result = await executeSingle(
			{ mode: "single", items: [{ prompt: "do", cwd: "/tmp" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe(
			"Invalid tasks[0].cwd: must be relative to the task tool working directory.",
		);
		expect(result.details.results).toHaveLength(0);
		expect(vi.mocked(runSingleTask)).not.toHaveBeenCalled();
	});
});

describe("executeChain", () => {
	beforeEach(() => {
		vi.mocked(buildSubprocessPrompt).mockReset();
		vi.mocked(resolveTaskConfig).mockReset();
		vi.mocked(runSingleTask).mockReset();
	});

	it("runs chain items in order", async () => {
		vi.mocked(buildSubprocessPrompt).mockImplementation((item: TaskWorkItem) => ({
			ok: true,
			prompt: `${item.prompt}-with-previous`,
		}));
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig());
		vi.mocked(runSingleTask)
			.mockResolvedValueOnce(makeResult({ prompt: "one", messageText: "one" }))
			.mockResolvedValueOnce(makeResult({ prompt: "two", messageText: "two" }));

		const result = await executeChain(
			{ mode: "chain", items: [{ prompt: "first" }, { prompt: "second" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe("two");
		expect(vi.mocked(runSingleTask)).toHaveBeenCalledTimes(2);
	});

	it("builds chain prompts from previous output and emits updates", async () => {
		const updates: string[] = [];
		const onUpdate: AgentToolUpdateCallback = (payload) => {
			updates.push(getFirstText(payload.content));
		};

		vi.mocked(buildSubprocessPrompt).mockImplementation((item: TaskWorkItem) => ({
			ok: true,
			prompt: item.prompt,
		}));
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig());
		vi.mocked(runSingleTask).mockImplementation(async (input: any) => {
			if (input.index === 1) {
				input.onResultUpdate?.(
					makeResult({
						prompt: input.item.prompt,
						messageText: "running first",
						index: 1,
					}),
				);
				return makeResult({
					prompt: input.subprocessPrompt,
					messageText: "first result",
					index: 1,
				});
			}
			input.onResultUpdate?.(
				makeResult({
					prompt: input.item.prompt,
					messageText: "running second",
					index: 2,
				}),
			);
			return makeResult({
				prompt: input.subprocessPrompt,
				messageText: "second result",
				index: 2,
			});
		});

		const result = await executeChain(
			{
				mode: "chain",
				items: [
					{ prompt: "first {step1} {previous}" },
					{ prompt: "second {step1} {previous}" },
				],
				thinking: "inherit",
			},
			state,
			makeContext(onUpdate),
		);

		expect(vi.mocked(runSingleTask)).toHaveBeenCalledTimes(2);
		expect(vi.mocked(runSingleTask).mock.calls[0]?.[0].subprocessPrompt).toBe("first {step1} ");
		expect(vi.mocked(runSingleTask).mock.calls[1]?.[0].subprocessPrompt).toBe(
			"second first result first result",
		);
		expect(getFirstText(result.content)).toBe("second result");
		expect(updates.length).toBeGreaterThanOrEqual(4);
	});

	it("stops if prompt construction fails on a later step", async () => {
		vi.mocked(buildSubprocessPrompt)
			.mockReturnValueOnce({ ok: true, prompt: "first" })
			.mockReturnValueOnce({ ok: false, error: "bad chain" });
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig());
		vi.mocked(runSingleTask).mockResolvedValue(
			makeResult({ prompt: "first", messageText: "first" }),
		);

		const result = await executeChain(
			{ mode: "chain", items: [{ prompt: "first" }, { prompt: "second" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe("bad chain");
	});

	it("stops on first failing step result", async () => {
		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: true, prompt: "prompt" });
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig());
		vi.mocked(runSingleTask).mockResolvedValue(
			makeResult({ prompt: "first", exitCode: 1, errorMessage: "nope" }),
		);

		const result = await executeChain(
			{ mode: "chain", items: [{ prompt: "first" }, { prompt: "second" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toContain("Chain stopped at step 1: nope");
	});

	it("stops when chain task config cannot be resolved", async () => {
		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: true, prompt: "prompt" });
		vi.mocked(resolveTaskConfig).mockReturnValue({ ok: false, error: "bad chain config" });

		const result = await executeChain(
			{ mode: "chain", items: [{ prompt: "first" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe("bad chain config");
		expect(vi.mocked(runSingleTask)).not.toHaveBeenCalled();
	});

	it("stops when a chain step resolves outside the working directory", async () => {
		vi.mocked(buildSubprocessPrompt).mockImplementation((item: TaskWorkItem) => ({
			ok: true,
			prompt: item.prompt,
		}));
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig());
		vi.mocked(runSingleTask).mockResolvedValue(
			makeResult({ prompt: "first", messageText: "first" }),
		);

		const result = await executeChain(
			{
				mode: "chain",
				items: [{ prompt: "first" }, { prompt: "second", cwd: "../outside" }],
				thinking: "inherit",
			},
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe(
			"Invalid tasks[1].cwd: must stay within the task tool working directory.",
		);
		expect(vi.mocked(runSingleTask)).toHaveBeenCalledTimes(1);
	});

	it("uses fallback text when final chain result has no output", async () => {
		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: true, prompt: "prompt" });
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig());
		vi.mocked(runSingleTask).mockResolvedValue(makeResult({ prompt: "first", empty: true }));

		const result = await executeChain(
			{ mode: "chain", items: [{ prompt: "first" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe("(no output)");
	});
});

describe("executeParallel", () => {
	beforeEach(() => {
		vi.mocked(buildSubprocessPrompt).mockReset();
		vi.mocked(resolveTaskConfig).mockReset();
		vi.mocked(runSingleTask).mockReset();
	});

	it("aggregates summary for all successful tasks", async () => {
		vi.mocked(buildSubprocessPrompt).mockImplementation((item: TaskWorkItem) => ({
			ok: true,
			prompt: item.prompt,
		}));
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig());
		vi.mocked(runSingleTask)
			.mockResolvedValueOnce(makeResult({ prompt: "first", messageText: "first" }))
			.mockResolvedValueOnce(makeResult({ prompt: "second", messageText: "second" }));

		const result = await executeParallel(
			{ mode: "parallel", items: [{ prompt: "first" }, { prompt: "second" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toContain("Parallel: 2/2 succeeded");
		expect(getFirstText(result.content)).toContain("first");
		expect(getFirstText(result.content)).toContain("second");
	});

	it("streams progress with updates and mixed success/failure", async () => {
		const updates: string[] = [];
		const onUpdate: AgentToolUpdateCallback = (payload) => {
			updates.push(getFirstText(payload.content));
		};

		vi.mocked(buildSubprocessPrompt).mockImplementation((item: TaskWorkItem) => ({
			ok: true,
			prompt: item.prompt,
		}));
		vi.mocked(resolveTaskConfig).mockReturnValue(makeOkConfig());
		vi.mocked(runSingleTask).mockImplementation(async (input: any) => {
			input.onResultUpdate?.(
				makeResult({
					prompt: input.item.prompt,
					messageText: `running ${input.index}`,
					toolCallCommand: `cmd-${input.index}`,
					index: input.index,
				}),
			);

			if (input.index === 1) {
				return makeResult({
					prompt: input.subprocessPrompt,
					messageText: "one",
					index: 1,
				});
			}

			return makeResult({
				prompt: input.subprocessPrompt,
				messageText: "two",
				exitCode: 1,
				errorMessage: "task failed",
				index: 2,
				skill: "read",
			});
		});

		const result = await executeParallel(
			{ mode: "parallel", items: [{ prompt: "first" }, { prompt: "second" }], thinking: "inherit" },
			state,
			makeContext(onUpdate),
		);

		expect(getFirstText(result.content)).toContain("Parallel: 1/2 succeeded");
		expect(getFirstText(result.content)).toContain("[task 1] completed: one");
		expect(getFirstText(result.content)).toContain("[read] failed: task failed");
		expect(updates.some((entry) => entry.includes("Parallel:") && entry.includes("bash("))).toBe(true);
		expect(updates.some((entry) => entry.includes("Parallel: 2/2 done"))).toBe(true);
	});

	it("returns raw prepare error before running", async () => {
		vi.mocked(buildSubprocessPrompt).mockReturnValue({ ok: false, error: "bad" });

		const result = await executeParallel(
			{ mode: "parallel", items: [{ prompt: "one" }, { prompt: "two" }], thinking: "inherit" },
			state,
			makeContext(),
		);

		expect(getFirstText(result.content)).toBe("bad");
	});
});
