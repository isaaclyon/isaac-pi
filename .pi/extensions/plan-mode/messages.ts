import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";

import type { NewSessionPlanPayload, PlanStep } from "./types.js";

export const PLAN_SYSTEM_PROMPT = `
You are currently in PLAN MODE.

Rules:
- You are in read-only mode. Do not modify files.
- Use only read-only tools to analyze and prepare a plan.
- Produce a structured plan with these sections:
  1) Goal
  2) Context
  3) Steps (numbered)
  4) Risks
  5) Open Questions
- After drafting or revising the plan, call the present_plan tool with:
  - title: short title for the plan
  - planMarkdown: the full plan markdown

If present_plan returns feedback, revise the plan and call present_plan again.
`;

export function buildExecutionSystemPrompt(steps: PlanStep[]): string {
	const remaining = steps.filter((step) => !step.completed);
	if (remaining.length === 0) {
		return "You are executing an approved plan. Continue carefully and report progress clearly.";
	}

	const remainingList = remaining.map((step) => `${step.step}. ${step.text}`).join("\n");
	return `
You are executing an approved plan.

Remaining steps:
${remainingList}

When you finish a numbered step, include marker [DONE:n] (for example [DONE:2]).
Complete steps in order unless blocked.
`;
}

export function buildExecutionKickoffMessage(payload: NewSessionPlanPayload): string {
	const stepList = payload.steps.map((step) => `${step.step}. ${step.text}`).join("\n");
	return [
		"Execute the approved plan below.",
		"",
		`Saved plan: ${payload.savedPath}`,
		"",
		`# ${payload.title}`,
		"",
		payload.markdown,
		"",
		"Execution instructions:",
		"- Start with step 1.",
		"- Include [DONE:n] markers as each step is completed.",
		"- Keep updates concise and practical.",
		"",
		"Step checklist:",
		stepList || "(no parsed numbered steps; execute the plan as written)",
	].join("\n");
}

export function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
	return message.role === "assistant" && Array.isArray(message.content);
}

export function getAssistantText(message: AssistantMessage): string {
	return message.content
		.filter((part): part is TextContent => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}
