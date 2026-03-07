import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolveRalphConfig } from "./config.js";
import { getRalphDb } from "./db.js";
import { RalphStore } from "./store.js";

export default function ralphLoopExtension(pi: ExtensionAPI): void {
	let enabled = false;

	pi.on("session_start", (_event, ctx) => {
		const config = resolveRalphConfig(ctx.cwd);
		enabled = config.enabled;
		if (!enabled) return;

		const db = getRalphDb(config.dbPath);
		void new RalphStore(db);

		if (ctx.hasUI) {
			ctx.ui.setStatus("ralph", "Ralph loop ready");
		}
	});

	pi.on("session_shutdown", (_event, ctx) => {
		if (!enabled) return;
		if (ctx.hasUI) {
			ctx.ui.setStatus("ralph", undefined);
		}
	});
}
