/**
 * Task extension — run isolated pi subprocess tasks.
 *
 * Modes: single, chain, parallel.
 * No session forking — the calling LLM writes context-rich, self-contained
 * prompts for each subprocess. This is cheaper and often better than cloning
 * the full session.
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type {
	AgentToolUpdateCallback,
	ExtensionAPI,
	ExtensionContext,
} from "@mariozechner/pi-coding-agent";
import { Type, type Static } from "@sinclair/typebox";

import { normalizeTaskParams } from "./params.js";
import { formatAvailableSkills, loadSkillDiscovery } from "./skills.js";
import {
	getBuiltInToolsFromActiveTools,
	MAX_TIMEOUT_SECONDS,
	THINKING_OPTIONS,
} from "./types.js";
import type { TaskToolDetails } from "./types.js";
import { executeChain, executeParallel, executeSingle } from "./execute.js";
import { renderCall, renderResult } from "./render.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const ThinkingSchema = StringEnum(THINKING_OPTIONS, {
	description:
		"Thinking level: off, minimal, low, medium, high, xhigh, or inherit (default: inherit)",
});

const ModelSchema = Type.Optional(
	Type.String({ description: "Model override: provider/modelId" }),
);

const TaskItemSchema = Type.Object({
	prompt: Type.String({
		description: "Task prompt — must be detailed and self-contained",
	}),
	name: Type.Optional(
		Type.String({ description: "Optional display name shown in the UI (e.g. 'Parse types', 'Write tests')" }),
	),
	skill: Type.Optional(Type.String({ description: "Optional skill name" })),
	model: ModelSchema,
	thinking: Type.Optional(ThinkingSchema),
	timeout: Type.Optional(
		Type.Number({
			description:
				"Per-task timeout in seconds. Overrides the top-level default. Must be > 0 and <= max timer-safe limit.",
			exclusiveMinimum: 0,
			maximum: MAX_TIMEOUT_SECONDS,
		}),
	),
	cwd: Type.Optional(
		Type.String({
			description:
				"Per-task working directory (relative path under parent cwd). Must stay inside parent cwd; absolute paths and '../' escapes are rejected.",
		}),
	),
});

const TaskParams = Type.Object({
	type: StringEnum(["single", "chain", "parallel"] as const, {
		description: "Execution mode",
	}),
	tasks: Type.Array(TaskItemSchema, {
		minItems: 1,
		description: "Tasks to run",
	}),
	model: ModelSchema,
	thinking: Type.Optional(ThinkingSchema),
	timeout: Type.Optional(
		Type.Number({
			description:
				"Default timeout in seconds applied to every task that doesn't set its own. Must be > 0 and <= max timer-safe limit.",
			exclusiveMinimum: 0,
			maximum: MAX_TIMEOUT_SECONDS,
		}),
	),
});

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SKILL_LIST_LIMIT = 30;

const TOOL_DESCRIPTION = `Run isolated pi subprocess tasks (single, chain, or parallel).

IMPORTANT: Each subprocess starts with NO conversation context. You must write
detailed, self-contained prompts that include all relevant context — file paths,
decisions made, constraints, and what to do. Think of it as writing a brief for
a colleague who hasn't been in the meeting.

Supports optional skill wrapper, optional model override (provider/modelId),
and optional per-task cwd override (relative path for monorepo subdirectories).`;

const SYSTEM_PROMPT_ADDITION = `

## Task tool — subprocess delegation

You have a \`task\` tool that spawns isolated pi subprocesses. Key rules:

1. **Write self-contained prompts.** Subprocesses have ZERO context from this
   conversation. Include: relevant file paths, decisions made, constraints,
   and the specific task. Think "briefing document for a new teammate."

2. **Use single for one job, parallel for independent jobs, chain for sequential
   steps** where each step's output feeds into the next via \`{previous}\`.
   You can also reference any earlier step by number: \`{step1}\`, \`{step2}\`, etc.
   This enables non-linear chains (e.g. a synthesis step that pulls from step 1
   and step 3, skipping step 2).

3. **Don't delegate trivially.** If a task takes one tool call, just do it yourself.
   Delegate when there's real work: multi-file refactors, parallel searches, etc.

4. **Per-task \`cwd\` override.** Each task item accepts an optional \`cwd\` field
   (a relative path resolved against the current working directory). It must
   stay inside the current working directory (no absolute paths or \`..\` escapes).
   Useful for monorepos to point at subdirectories like \`"packages/api"\`.

5. **When the user says something brief** like "refactor this" or "fix the tests",
   YOU expand that into a detailed prompt with all the context the subprocess needs.`;

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.registerTool<typeof TaskParams, TaskToolDetails>({
		name: "task",
		label: "Task",
		description: TOOL_DESCRIPTION,
		parameters: TaskParams,

		async execute(
			_toolCallId: string,
			params: Static<typeof TaskParams>,
			signal: AbortSignal | undefined,
			onUpdate: AgentToolUpdateCallback<TaskToolDetails> | undefined,
			ctx: ExtensionContext,
		) {
			const normalized = normalizeTaskParams(params as unknown);
			if (!normalized.ok) {
				const discovery = loadSkillDiscovery(ctx.cwd);
				const avail = formatAvailableSkills(
					discovery.skills,
					SKILL_LIST_LIMIT,
				);
				const suffix =
					avail.remaining > 0
						? `, ... +${avail.remaining} more`
						: "";
				return {
					content: [
						{
							type: "text",
							text: `${normalized.error}\nAvailable skills: ${avail.text}${suffix}`,
						},
					],
					details: { mode: "single", results: [] },
				};
			}

			const { mode } = normalized.value;
			const discovery = loadSkillDiscovery(ctx.cwd);
			const builtInTools = getBuiltInToolsFromActiveTools(
				pi.getActiveTools(),
			);
			const ctxModel = ctx.model
				? { provider: ctx.model.provider, id: ctx.model.id }
				: undefined;

			const ectx = {
				cwd: ctx.cwd,
				ctxModel,
				inheritedThinking: pi.getThinkingLevel(),
				builtInTools,
				signal,
				onUpdate,
			};

			if (mode === "single") {
				return executeSingle(normalized.value, discovery, ectx);
			}
			if (mode === "chain") {
				return executeChain(normalized.value, discovery, ectx);
			}
			return executeParallel(normalized.value, discovery, ectx);
		},

		renderCall(args, theme) {
			return renderCall(args as Record<string, unknown>, theme);
		},

		renderResult(result, options, theme) {
			return renderResult(result, options, theme);
		},
	});

	// Patch system prompt to instruct LLM on task tool usage
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: event.systemPrompt + SYSTEM_PROMPT_ADDITION,
		};
	});
}
