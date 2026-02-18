/**
 * Parameter validation and normalization for the task tool.
 */

import {
	MAX_TASKS,
	THINKING_OPTIONS,
	type NormalizedParams,
	type ProviderModel,
	type TaskThinking,
	type TaskWorkItem,
} from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function isRecord(
	value: unknown,
): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function isTaskThinking(value: string): value is TaskThinking {
	return (THINKING_OPTIONS as readonly string[]).includes(value);
}

// ---------------------------------------------------------------------------
// Model parsing
// ---------------------------------------------------------------------------

export function parseProviderModel(
	value: string,
): { ok: true; model: ProviderModel } | { ok: false; error: string } {
	const trimmed = value.trim();
	const slash = trimmed.indexOf("/");
	if (slash <= 0 || slash === trimmed.length - 1) {
		return {
			ok: false,
			error: `Invalid model format: "${value}". Expected provider/modelId.`,
		};
	}
	const provider = trimmed.slice(0, slash);
	const modelId = trimmed.slice(slash + 1);
	return {
		ok: true,
		model: { provider, modelId, label: `${provider}/${modelId}` },
	};
}

export function resolveModel(
	modelOverride: string | undefined,
	ctxModel: { provider: string; id: string } | undefined,
): { ok: true; model: ProviderModel | undefined } | { ok: false; error: string } {
	if (modelOverride) {
		const parsed = parseProviderModel(modelOverride);
		if (!parsed.ok) return parsed;
		return { ok: true, model: parsed.model };
	}
	if (!ctxModel) return { ok: true, model: undefined };
	return {
		ok: true,
		model: {
			provider: ctxModel.provider,
			modelId: ctxModel.id,
			label: `${ctxModel.provider}/${ctxModel.id}`,
		},
	};
}

// ---------------------------------------------------------------------------
// Field normalizers
// ---------------------------------------------------------------------------

function normalizeString(
	value: unknown,
	label: string,
): Result<string | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	if (typeof value !== "string") {
		return { ok: false, error: `Invalid parameters: ${label} must be a string.` };
	}
	const trimmed = value.trim();
	return { ok: true, value: trimmed || undefined };
}

function normalizeThinking(
	value: unknown,
	label: string,
): Result<TaskThinking | undefined> {
	if (value === undefined) return { ok: true, value: undefined };
	if (typeof value !== "string") {
		return { ok: false, error: `Invalid parameters: ${label} must be a string.` };
	}
	const trimmed = value.trim();
	if (!trimmed) return { ok: true, value: undefined };
	if (!isTaskThinking(trimmed)) {
		return {
			ok: false,
			error: `Invalid parameters: ${label} must be one of ${THINKING_OPTIONS.join(", ")}.`,
		};
	}
	return { ok: true, value: trimmed };
}

// ---------------------------------------------------------------------------
// Task items
// ---------------------------------------------------------------------------

function parseTaskItems(
	rawTasks: unknown[],
): { ok: true; items: TaskWorkItem[] } | { ok: false; error: string } {
	const items: TaskWorkItem[] = [];
	for (const [idx, entry] of rawTasks.entries()) {
		if (!isRecord(entry)) {
			return { ok: false, error: "Invalid task item: expected an object." };
		}

		const prompt =
			typeof entry.prompt === "string" ? entry.prompt.trim() : "";
		const skill =
			typeof entry.skill === "string" ? entry.skill.trim() : undefined;
		if (!prompt && !skill) {
			return {
				ok: false,
				error: 'Invalid task item: provide a non-empty "prompt" or "skill".',
			};
		}

		const modelRes = normalizeString(entry.model, `tasks[${idx}].model`);
		if (!modelRes.ok) return modelRes;

		const thinkRes = normalizeThinking(
			entry.thinking,
			`tasks[${idx}].thinking`,
		);
		if (!thinkRes.ok) return thinkRes;

		items.push({
			prompt,
			skill: skill || undefined,
			model: modelRes.value,
			thinking: thinkRes.value,
		});
	}
	return { ok: true, items };
}

// ---------------------------------------------------------------------------
// Top-level normalization
// ---------------------------------------------------------------------------

export function normalizeTaskParams(
	params: unknown,
): { ok: true; value: NormalizedParams } | { ok: false; error: string } {
	if (!isRecord(params)) {
		return { ok: false, error: "Invalid parameters: expected an object." };
	}

	const mode = params.type;
	if (typeof mode !== "string") {
		return { ok: false, error: '"type" must be a string.' };
	}

	const modelRes = normalizeString(params.model, '"model"');
	if (!modelRes.ok) return modelRes;

	const thinkRes = normalizeThinking(params.thinking, '"thinking"');
	if (!thinkRes.ok) return thinkRes;
	const thinking = thinkRes.value ?? "inherit";

	const rawTasks = Array.isArray(params.tasks) ? params.tasks : [];

	if (mode === "single") {
		if (rawTasks.length !== 1) {
			return {
				ok: false,
				error: 'type="single" requires exactly one task in "tasks".',
			};
		}
		const parsed = parseTaskItems(rawTasks);
		if (!parsed.ok) return parsed;
		return {
			ok: true,
			value: {
				mode: "single",
				model: modelRes.value,
				thinking,
				items: parsed.items,
			},
		};
	}

	if (mode === "parallel" || mode === "chain") {
		if (rawTasks.length === 0) {
			return {
				ok: false,
				error: `type="${mode}" requires a non-empty "tasks" array.`,
			};
		}
		if (rawTasks.length > MAX_TASKS) {
			return {
				ok: false,
				error: `Too many ${mode} tasks (${rawTasks.length}). Max is ${MAX_TASKS}.`,
			};
		}
		const parsed = parseTaskItems(rawTasks);
		if (!parsed.ok) return parsed;
		return {
			ok: true,
			value: {
				mode,
				model: modelRes.value,
				thinking,
				items: parsed.items,
			},
		};
	}

	return {
		ok: false,
		error: '"type" must be "single", "chain", or "parallel".',
	};
}
