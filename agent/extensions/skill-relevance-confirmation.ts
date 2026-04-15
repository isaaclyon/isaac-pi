import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const SKILL_RELEVANCE_INSTRUCTION =
	'Before responding, if any available skill is relevant to the user\'s request, state exactly: "{x skill} is relevant to this request", invoke that skill, and then continue.';

export default function skillRelevanceConfirmationExtension(pi: ExtensionAPI): void {
	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: `${event.systemPrompt}\n\n${SKILL_RELEVANCE_INSTRUCTION}`,
		};
	});
}
