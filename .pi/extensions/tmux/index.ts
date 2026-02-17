import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerTmuxTools } from "./register-tools";
import { registerServeTools } from "./register-serve-tools";
import { ServeManager } from "./serve-manager";

export default function tmuxExtension(pi: ExtensionAPI): void {
	const serveManager = new ServeManager(pi);

	registerTmuxTools(pi);
	registerServeTools(pi, serveManager);

	pi.on("session_start", async (_event, ctx) => {
		serveManager.setContext(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		serveManager.setContext(ctx);
	});

	pi.on("session_shutdown", async () => {
		serveManager.stopAll();
	});
}
