import { describe, expect, it } from "vitest";
import { MAX_TIMEOUT_SECONDS } from "./types.js";
import {
	parseProviderModel,
	normalizeTaskParams,
	resolveModel,
} from "./params.js";

const SAMPLE_CTX_MODEL = { provider: "openai", id: "gpt-4o" };

describe("parseProviderModel", () => {
	it("accepts provider/modelId strings", () => {
		const parsed = parseProviderModel("openai/gpt-4o");
		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.model).toEqual({
			provider: "openai",
			modelId: "gpt-4o",
			label: "openai/gpt-4o",
		});
	});

	it("rejects malformed model identifiers", () => {
		expect(parseProviderModel("bad")).toMatchObject({ ok: false });
		expect(parseProviderModel("bad/")).toMatchObject({ ok: false });
		expect(parseProviderModel("/bad"))
			.toMatchObject({ ok: false });
	});
});

describe("resolveModel", () => {
	it("uses override when provided", () => {
		const resolved = resolveModel("anthropic/claude-3-7-sonnet", SAMPLE_CTX_MODEL);
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.model).toEqual({
			provider: "anthropic",
			modelId: "claude-3-7-sonnet",
			label: "anthropic/claude-3-7-sonnet",
		});
	});

	it("falls back to context model when no override", () => {
		const resolved = resolveModel(undefined, SAMPLE_CTX_MODEL);
		expect(resolved.ok).toBe(true);
		if (!resolved.ok) return;
		expect(resolved.model).toEqual({
			provider: "openai",
			modelId: "gpt-4o",
			label: "openai/gpt-4o",
		});
	});

	it("returns undefined model when no override and no context model", () => {
		const resolved = resolveModel(undefined, undefined);
		expect(resolved).toEqual({ ok: true, model: undefined });
	});
});

describe("normalizeTaskParams", () => {
	it("validates single mode requires exactly one task", () => {
		const noTask = normalizeTaskParams({ type: "single", tasks: [] });
		expect(noTask).toMatchObject({ ok: false });

		const tooMany = normalizeTaskParams({
			type: "single",
			tasks: [{ prompt: "one" }, { prompt: "two" }],
		});
		expect(tooMany).toMatchObject({ ok: false });
		const valid = normalizeTaskParams({
			type: "single",
			tasks: [{ prompt: "single prompt" }],
		});
		expect(valid.ok).toBe(true);
		if (!valid.ok) return;
		expect(valid.value.items).toHaveLength(1);
	});

	it("validates top-level inputs and limits", () => {
		const badMode = normalizeTaskParams({ type: 123, tasks: [{ prompt: "work" }] });
		expect(badMode).toMatchObject({ ok: false });

		const badType = normalizeTaskParams({ type: "unknown", tasks: [{ prompt: "work" }] });
		expect(badType).toMatchObject({ ok: false });

		const badItem = normalizeTaskParams({ type: "single", tasks: ["no" as never] });
		expect(badItem).toMatchObject({ ok: false });

		const nonObjectParams = normalizeTaskParams("nope");
		expect(nonObjectParams).toMatchObject({ ok: false });
	});

	it("supports chain mode with a single item", () => {
		const chain = normalizeTaskParams({
			type: "chain",
			tasks: [{ prompt: "chain prompt" }],
		});
		expect(chain).toMatchObject({ ok: true });
		if (!chain.ok) return;
		expect(chain.value.mode).toBe("chain");
		expect(chain.value.items).toHaveLength(1);
	});

	it("validates chain mode payload constraints", () => {
		const noTasks = normalizeTaskParams({ type: "chain", tasks: [] });
		expect(noTasks).toMatchObject({ ok: false });

		const tooMany = normalizeTaskParams({
			type: "chain",
			tasks: Array.from({ length: 9 }, () => ({ prompt: "work" })),
		});
		expect(tooMany).toMatchObject({ ok: false });
	});

	it("enforces bounds and secure cwd for parallel tasks", () => {
		const tooManyTasks = normalizeTaskParams({
			type: "parallel",
			tasks: Array.from({ length: 9 }, () => ({ prompt: "work" })),
		});
		expect(tooManyTasks).toMatchObject({ ok: false });

		const badTimeout = normalizeTaskParams({
			type: "parallel",
			timeout: MAX_TIMEOUT_SECONDS + 1,
			tasks: [{ prompt: "work" }],
		});
		expect(badTimeout).toMatchObject({ ok: false });

		const badTaskTimeout = normalizeTaskParams({
			type: "parallel",
			tasks: [{ prompt: "work", timeout: MAX_TIMEOUT_SECONDS + 1 }],
		});
		expect(badTaskTimeout).toMatchObject({ ok: false });

		const badCwd = normalizeTaskParams({
			type: "parallel",
			tasks: [{ prompt: "work", cwd: "/tmp" }],
		});
		expect(badCwd).toMatchObject({ ok: false });

		const badThinking = normalizeTaskParams({
			type: "parallel",
			thinking: "quantum",
			tasks: [{ prompt: "work" }],
		});
		expect(badThinking).toMatchObject({ ok: false });

		const badTaskThinking = normalizeTaskParams({
			type: "single",
			tasks: [{ prompt: "work", thinking: 123 as never }],
		});
		expect(badTaskThinking).toMatchObject({ ok: false });

		const badTimeoutValue = normalizeTaskParams({
			type: "parallel",
			timeout: -1,
			tasks: [{ prompt: "work" }],
		});
		expect(badTimeoutValue).toMatchObject({ ok: false });

		const badTaskTimeoutValue = normalizeTaskParams({
			type: "single",
			tasks: [{ prompt: "work", timeout: -1 }],
		});
		expect(badTaskTimeoutValue).toMatchObject({ ok: false });

		const goodCwd = normalizeTaskParams({
			type: "parallel",
			tasks: [{ prompt: "work", cwd: "subdir" }],
		});
		expect(goodCwd.ok).toBe(true);
		if (!goodCwd.ok) return;
		expect(goodCwd.value.items[0].cwd).toBe("subdir");
	});

	it("validates task payload content", () => {
		const noPromptOrSkill = normalizeTaskParams({
			type: "single",
			tasks: [{ prompt: "" }],
		});
		expect(noPromptOrSkill).toMatchObject({ ok: false });

		const nonStringTaskType = normalizeTaskParams({
			type: "single",
			tasks: [{ prompt: 12 } as never],
		});
		expect(nonStringTaskType).toMatchObject({ ok: false });
	});

	it("normalizes per-task optional fields", () => {
		const normalized = normalizeTaskParams({
			type: "single",
			tasks: [
				{
					name: "  worker  ",
					prompt: "  say hi  ",
					model: "openai/gpt-4o-mini",
					thinking: "low",
					timeout: 15,
					cwd: "  temp/dir  ",
				},
			],
		});
		expect(normalized.ok).toBe(true);
		if (!normalized.ok) return;
		expect(normalized.value.items[0]).toMatchObject({
			name: "worker",
			prompt: "say hi",
			model: "openai/gpt-4o-mini",
			thinking: "low",
			timeout: 15,
			cwd: "temp/dir",
		});
	});

	it("supports blank task fields that normalize to undefined", () => {
		const result = normalizeTaskParams({
			type: "single",
			tasks: [
				{
					prompt: "work",
					model: "   ",
					thinking: "   ",
				},
			],
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.items[0].model).toBeUndefined();
		expect(result.value.items[0].thinking).toBeUndefined();
	});

	it("rejects invalid per-task model values", () => {
		const badTaskModel = normalizeTaskParams({
			type: "single",
			tasks: [{ prompt: "work", model: 999 as never }],
		});
		expect(badTaskModel).toMatchObject({ ok: false });
	});
});
