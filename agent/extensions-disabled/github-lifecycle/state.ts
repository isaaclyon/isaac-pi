import type { PrSnapshot } from "./github.js";

export const TRACKER_STATE_TYPE = "github-pr-lifecycle";

export type TrackedPrRef = {
	repo: string;
	prNumber: number;
};

export type TrackerState = {
	trackedPr: TrackedPrRef | null;
	snapshot: PrSnapshot | null;
	lastAnnouncedKey: string | null;
	lastError: string | null;
	lastPolledAt: string | null;
	trackingSource: "auto" | "manual" | null;
};

type SessionEntryLike = {
	type?: string;
	customType?: string;
	data?: unknown;
};

export function createEmptyTrackerState(): TrackerState {
	return {
		trackedPr: null,
		snapshot: null,
		lastAnnouncedKey: null,
		lastError: null,
		lastPolledAt: null,
		trackingSource: null,
	};
}

export function getLatestTrackerState(entries: SessionEntryLike[]): TrackerState {
	let state = createEmptyTrackerState();

	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== TRACKER_STATE_TYPE || !entry.data || typeof entry.data !== "object") {
			continue;
		}

		state = {
			...state,
			...(entry.data as Partial<TrackerState>),
		};
	}

	return state;
}
