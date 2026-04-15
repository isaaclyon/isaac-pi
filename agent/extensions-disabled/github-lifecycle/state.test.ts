import { describe, expect, it } from "vitest";

import { createEmptyTrackerState, getLatestTrackerState, TRACKER_STATE_TYPE } from "./state.js";

describe("github lifecycle persisted state", () => {
	it("returns an empty tracker state when no entries exist", () => {
		expect(getLatestTrackerState([])).toEqual(createEmptyTrackerState());
	});

	it("restores the latest matching custom entry", () => {
		const state = getLatestTrackerState([
			{ type: "custom", customType: "other", data: { ignored: true } },
			{ type: "custom", customType: TRACKER_STATE_TYPE, data: { trackedPr: { repo: "acme/widgets", prNumber: 12 }, lastAnnouncedKey: "old" } },
			{ type: "custom", customType: TRACKER_STATE_TYPE, data: { trackedPr: { repo: "acme/widgets", prNumber: 123 }, lastAnnouncedKey: "new" } },
		]);

		expect(state.trackedPr).toEqual({ repo: "acme/widgets", prNumber: 123 });
		expect(state.lastAnnouncedKey).toBe("new");
	});
});
