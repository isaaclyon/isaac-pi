import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

import { createMempalaceOperations } from "./operations.js";
import { registerMempalaceExtension } from "./register.js";

export default function mempalaceExtension(pi: ExtensionAPI): void {
	registerMempalaceExtension(pi, createMempalaceOperations());
}
