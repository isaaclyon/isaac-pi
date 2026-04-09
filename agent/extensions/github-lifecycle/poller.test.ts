import { describe, expect, it } from "vitest";

import type { PrSnapshot } from "./github.js";
import { getAnnouncement, getAnnouncementKey, getPollIntervalMs, stabilizeSnapshot } from "./poller.js";

function buildSnapshot(overrides: Partial<PrSnapshot> = {}): PrSnapshot {
	return {
		repo: "acme/widgets",
		prNumber: 123,
		title: "Add PR lifecycle tracker",
		url: "https://github.com/acme/widgets/pull/123",
		headRefName: "feature/pr-tracker",
		baseRefName: "main",
		isDraft: false,
		updatedAt: "2026-04-08T22:00:00Z",
		mergedAt: null,
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		checks: {
			total: 0,
			pending: 0,
			successful: 0,
			failing: [],
		},
		lifecycle: "open",
		...overrides,
	};
}

describe("github lifecycle polling helpers", () => {
	it("uses faster polling while checks are pending and stops after terminal states", () => {
		expect(getPollIntervalMs(buildSnapshot({ lifecycle: "checks_pending" }))).toBe(5_000);
		expect(getPollIntervalMs(buildSnapshot({ lifecycle: "checks_failed" }))).toBe(30_000);
		expect(getPollIntervalMs(buildSnapshot({ lifecycle: "merged" }))).toBeNull();
	});

	it("announces failed checks once per unique failure set", () => {
		const previous = buildSnapshot({ lifecycle: "checks_pending", checks: { total: 2, pending: 2, successful: 0, failing: [] } });
		const next = buildSnapshot({ lifecycle: "checks_failed", checks: { total: 2, pending: 0, successful: 0, failing: ["lint", "test"] } });

		const announcement = getAnnouncement(previous, next, null);
		expect(announcement).toMatchObject({
			level: "error",
			key: getAnnouncementKey(next),
		});
		expect(announcement?.text).toContain("CI failed");
		expect(announcement?.text).toContain("lint");
		expect(announcement?.text).toContain("test");

		expect(getAnnouncement(previous, next, getAnnouncementKey(next))).toBeNull();
	});

	it("announces recovery and merge conflicts on transitions", () => {
		const failed = buildSnapshot({ lifecycle: "checks_failed", checks: { total: 2, pending: 0, successful: 0, failing: ["test"] } });
		const passed = buildSnapshot({ lifecycle: "checks_passed", checks: { total: 2, pending: 0, successful: 2, failing: [] } });
		expect(getAnnouncement(failed, passed, null)?.text).toContain("all required checks passed");

		const clean = buildSnapshot({ lifecycle: "open" });
		const conflict = buildSnapshot({ lifecycle: "merge_conflict", mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" });
		expect(getAnnouncement(clean, conflict, null)).toMatchObject({ level: "warning" });
		expect(getAnnouncement(clean, conflict, null)?.text).toContain("merge conflict");
	});

	it("does not treat the first observed all-green snapshot as passed yet", () => {
		const firstSeenGreen = buildSnapshot({
			lifecycle: "checks_passed",
			checks: { total: 2, pending: 0, successful: 2, failing: [] },
		});

		expect(stabilizeSnapshot(null, firstSeenGreen).lifecycle).toBe("open");
		expect(stabilizeSnapshot(buildSnapshot({ lifecycle: "checks_pending" }), firstSeenGreen).lifecycle).toBe("checks_passed");
	});
});
