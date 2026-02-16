/**
 * Process runtime adapter.
 *
 * Wraps the existing direct subprocess runner to preserve behavior.
 */

import { runIsolatedAgent, type RunnerOpts } from "../runner.ts";
import type { RunnerResult } from "../types.ts";
import type { OneShotRuntimeAdapter } from "./types.ts";

export class ProcessRuntimeAdapter implements OneShotRuntimeAdapter {
	readonly mode = "process" as const;

	runOneShot(opts: RunnerOpts): Promise<RunnerResult> {
		return runIsolatedAgent(opts);
	}
}
