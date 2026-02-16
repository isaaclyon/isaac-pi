/**
 * Coding Conventions Extension
 *
 * Injects Isaac's coding conventions into the system prompt so they
 * apply in every project where this package is installed.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export default function codingConventions(pi: ExtensionAPI) {
	// Load conventions from the markdown file next to this extension
	const extDir = dirname(fileURLToPath(import.meta.url));
	const conventionsPath = join(extDir, "conventions.md");
	let conventions: string;

	try {
		conventions = readFileSync(conventionsPath, "utf-8");
	} catch {
		console.error("Warning: Could not load conventions.md");
		return;
	}

	pi.on("before_agent_start", async (event) => {
		return {
			systemPrompt: event.systemPrompt + "\n\n" + conventions,
		};
	});
}
