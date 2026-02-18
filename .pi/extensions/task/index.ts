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
import { getBuiltInToolsFromActiveTools, THINKING_OPTIONS } from "./types.js";
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
	skill: Type.Optional(Type.String({ description: "Optional skill name" })),
	model: ModelSchema,
	thinking: Type.Optional(ThinkingSchema),
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

Supports optional skill wrapper and optional model override (provider/modelId).`;

const SYSTEM_PROMPT_ADDITION = `

## Task tool — subprocess delegation

You have a \`task\` tool that spawns isolated pi subprocesses. Key rules:

1. **Write self-contained prompts.** Subprocesses have ZERO context from this
   conversation. Include: relevant file paths, decisions made, constraints,
   and the specific task. Think "briefing document for a new teammate."

2. **Use single for one job, parallel for independent jobs, chain for sequential
   steps** where each step's output feeds into the next via \`{previous}\`.

3. **Don't delegate trivially.** If a task takes one tool call, just do it yourself.
   Delegate when there's real work: multi-file refactors, parallel searches, etc.

4. **When the user says something brief** like "refactor this" or "fix the tests",
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
