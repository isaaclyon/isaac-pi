/**
 * Reload Runtime Extension
 *
 * Provides an LLM-callable tool that triggers the built-in user-facing
 * `/reload-runtime` command to reload extensions, skills, prompts, and themes.
 *
 * Based on: https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/examples/extensions/reload-runtime.ts
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
	let queuedByTool = false;
	let queuedResetTimer: ReturnType<typeof setTimeout> | undefined;

	const clearQueuedByTool = () => {
		queuedByTool = false;
		if (queuedResetTimer) {
			clearTimeout(queuedResetTimer);
			queuedResetTimer = undefined;
		}
	};

	// LLM-callable tool. Tools get ExtensionContext, so they cannot call reload directly.
	// Trigger the built-in user-facing reload command and guard against duplicate queue loops.
	pi.registerTool({
		name: "reload_runtime",
		label: "Reload Runtime",
		description: "Reload extensions, skills, prompts, and themes",
		parameters: Type.Object({}),
		async execute() {
			if (queuedByTool) {
				return {
					content: [{ type: "text", text: "Reload already queued. Skipping duplicate request." }],
					details: {},
				};
			}

			queuedByTool = true;
			queuedResetTimer = setTimeout(() => {
				clearQueuedByTool();
			}, 5000);

			pi.sendUserMessage("/reload-runtime", { deliverAs: "followUp" });
			return {
				content: [{ type: "text", text: "Queued /reload-runtime as a follow-up command." }],
				details: {},
			};
		},
	});
}
