/**
 * Runtime adapter contracts.
 */

import type { RunnerOpts } from "../runner.ts";
import type { RunnerResult, RuntimeMode } from "../types.ts";

/** One-shot runtime interface used by single/parallel/chain flows. */
export interface OneShotRuntimeAdapter {
	readonly mode: RuntimeMode;
	runOneShot(opts: RunnerOpts): Promise<RunnerResult>;
}
