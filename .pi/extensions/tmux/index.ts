import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerTmuxTools } from "./register-tools";

export default function tmuxExtension(pi: ExtensionAPI): void {
	registerTmuxTools(pi);
}
