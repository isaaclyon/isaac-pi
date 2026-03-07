import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { registerWorktreeTools } from "./register-tools";

export default function worktreeExtension(pi: ExtensionAPI): void {
	registerWorktreeTools(pi);
}
