import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { stripEmptyHtmlComments } from "./sanitize.ts";

export default function reasoningCleanup(pi: ExtensionAPI): void {
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant") return;

		let changed = false;
		const content = event.message.content.map((block) => {
			if (block.type !== "thinking") return block;
			const thinking = stripEmptyHtmlComments(block.thinking);
			if (thinking === block.thinking) return block;
			changed = true;
			return { ...block, thinking };
		});

		if (changed) return { message: { ...event.message, content } };
	});
}
