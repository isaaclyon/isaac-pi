import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const INSIGHT_GUIDANCE_MARKER = "<!-- isaac-pi:append-system-insight-guidance -->";
const TEMPLATE_PATH = path.resolve(fileURLToPath(import.meta.url), "..", "..", "APPEND_SYSTEM.md");

function loadTemplate(): string | null {
	try {
		const text = readFileSync(TEMPLATE_PATH, "utf8").trim();
		return text.length > 0 ? text : null;
	} catch {
		return null;
	}
}

function ensureAppendSystemFile(cwd: string, template: string): "created" | "appended" | "unchanged" {
	const targetPath = path.join(cwd, ".pi", "APPEND_SYSTEM.md");

	if (!existsSync(targetPath)) {
		mkdirSync(path.dirname(targetPath), { recursive: true });
		writeFileSync(targetPath, `${template}\n`, "utf8");
		return "created";
	}

	const current = readFileSync(targetPath, "utf8");
	if (current.includes(INSIGHT_GUIDANCE_MARKER)) {
		return "unchanged";
	}

	const prefix = current.trimEnd();
	const joined = prefix.length > 0 ? `${prefix}\n\n${template}\n` : `${template}\n`;
	writeFileSync(targetPath, joined, "utf8");
	return "appended";
}

export default function (pi: ExtensionAPI): void {
	const template = loadTemplate();
	if (!template) return;

	pi.on("session_start", async (_event, ctx) => {
		const result = ensureAppendSystemFile(ctx.cwd, template);
		if (result === "created") {
			ctx.ui.notify("isaac-pi: created .pi/APPEND_SYSTEM.md with insight guidance (run /reload to activate now)", "info");
		}
		if (result === "appended") {
			ctx.ui.notify("isaac-pi: appended insight guidance to .pi/APPEND_SYSTEM.md (run /reload to activate now)", "info");
		}
	});
}
