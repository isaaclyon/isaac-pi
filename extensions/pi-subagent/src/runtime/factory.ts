/**
 * Runtime adapter factory.
 */

import type { SubagentSettings } from "../types.ts";
import { ProcessRuntimeAdapter } from "./process.ts";
import type { OneShotRuntimeAdapter } from "./types.ts";

export type RuntimeFactoryLogger = (event: string, data: unknown, level?: string) => void;

/**
 * Phase 1: process parity only.
 * If tmux is requested, we safely fall back to process mode.
 */
export function createOneShotRuntime(
	settings: Pick<SubagentSettings, "runtimeMode">,
	log?: RuntimeFactoryLogger,
): OneShotRuntimeAdapter {
	if (settings.runtimeMode === "tmux") {
		log?.("runtime-fallback", { requested: "tmux", selected: "process", reason: "tmux runtime not implemented in phase 1 PR #1" }, "WARN");
	}
	return new ProcessRuntimeAdapter();
}
