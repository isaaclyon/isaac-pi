type BuildHandoffCompactionPromptArgs = {
	conversationText: string;
	previousSummary?: string;
	customInstructions?: string;
	isSplitTurn?: boolean;
};

export const HANDOFF_SYSTEM_PROMPT = `You are a context transfer assistant.

You will receive coding-session conversation history and must produce a compact, handoff-quality summary that lets a new assistant continue immediately.

Do NOT continue the conversation. Do NOT propose unrelated work. ONLY output the requested summary in the exact structure from the user prompt.`;

export function buildHandoffCompactionPrompt({
	conversationText,
	previousSummary,
	customInstructions,
	isSplitTurn,
}: BuildHandoffCompactionPromptArgs): string {
	let prompt = `## Conversation History

${conversationText}\n\n`;

	if (previousSummary?.trim()) {
		prompt += `## Previous Compaction Summary\n\n${previousSummary}\n\n`;
	}

	if (isSplitTurn) {
		prompt +=
			"Note: this compaction may include an early prefix from a split turn. Preserve any context needed so the retained suffix still makes sense.\n\n";
	}

	if (customInstructions?.trim()) {
		prompt += `## Additional Focus\n\n${customInstructions}\n\n`;
	}

	prompt += `Create a self-contained handoff summary using this exact structure:

## Context
### What was decided
- ...

### What was done
- ...

### Blockers
- ... (or "(none)")

### Key files touched
- path/to/file
- ... (or "(none)")

## Task
### Current state
- ...

### Next concrete step(s)
1. ...
2. ...

Requirements:
- Keep it concise but complete.
- Preserve exact file paths, function names, and error messages.
- Focus on continuity for immediate next action.`;

	return prompt;
}

export function extractTextContent(content: Array<{ type: string; text?: string }>): string {
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n")
		.trim();
}
