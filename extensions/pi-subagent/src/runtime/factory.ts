/**
 * Runtime adapter factory.
 */

import type { SubagentSettings } from "../types.ts";
import { ProcessRuntimeAdapter } from "./process.ts";
import type { OneShotRuntimeAdapter } from "./types.ts";

export type RuntimeFactoryLogger = (event: string, data: unknown, level?: string) => void;

export function createOneShotRuntime(
	_settings: SubagentSettings,
	log?: RuntimeFactoryLogger,
): OneShotRuntimeAdapter {
	log?.("runtime", { mode: "process" });
	return new ProcessRuntimeAdapter();
}
