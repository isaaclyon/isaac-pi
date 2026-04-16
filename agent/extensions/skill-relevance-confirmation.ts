import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SKILL_RELEVANCE_INSTRUCTION = "Invoke any relevant skills.";

export default function skillRelevanceConfirmationExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n\n${SKILL_RELEVANCE_INSTRUCTION}`,
		};
	});
}
