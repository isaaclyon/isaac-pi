import { describe, expect, it } from "vitest";

import { formatFooterStatus, parsePrViewJson } from "./github.js";

function buildPrJson(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		number: 123,
		title: "Add PR lifecycle tracker",
		url: "https://github.com/acme/widgets/pull/123",
		state: "OPEN",
		isDraft: false,
		mergedAt: null,
		mergeable: "MERGEABLE",
		mergeStateStatus: "CLEAN",
		statusCheckRollup: [],
		headRefName: "feature/pr-tracker",
		baseRefName: "main",
		updatedAt: "2026-04-08T22:00:00Z",
		...overrides,
	});
}

describe("github PR snapshot parsing", () => {
	it("normalizes failing checks", () => {
		const snapshot = parsePrViewJson(
			buildPrJson({
				statusCheckRollup: [
					{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" },
					{ __typename: "StatusContext", context: "lint", state: "FAILURE" },
					{ __typename: "CheckRun", name: "typecheck", status: "COMPLETED", conclusion: "SUCCESS" },
				],
			}),
		);

		expect(snapshot.repo).toBe("acme/widgets");
		expect(snapshot.lifecycle).toBe("checks_failed");
		expect(snapshot.checks.pending).toBe(0);
		expect(snapshot.checks.failing).toEqual(["lint", "test"]);
	});

	it("normalizes pending and passed checks", () => {
		const pending = parsePrViewJson(
			buildPrJson({
				statusCheckRollup: [
					{ __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: null },
					{ __typename: "StatusContext", context: "lint", state: "PENDING" },
				],
			}),
		);
		expect(pending.lifecycle).toBe("checks_pending");
		expect(pending.checks.pending).toBe(2);

		const passed = parsePrViewJson(
			buildPrJson({
				statusCheckRollup: [
					{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "SUCCESS" },
					{ __typename: "StatusContext", context: "lint", state: "SUCCESS" },
				],
			}),
		);
		expect(passed.lifecycle).toBe("checks_passed");
		expect(passed.checks.successful).toBe(2);
	});

	it("prioritizes merge conflict and terminal states", () => {
		const conflicting = parsePrViewJson(buildPrJson({ mergeable: "CONFLICTING", mergeStateStatus: "DIRTY" }));
		expect(conflicting.lifecycle).toBe("merge_conflict");

		const merged = parsePrViewJson(buildPrJson({ mergedAt: "2026-04-08T22:03:00Z", state: "MERGED" }));
		expect(merged.lifecycle).toBe("merged");

		const closed = parsePrViewJson(buildPrJson({ state: "CLOSED" }));
		expect(closed.lifecycle).toBe("closed");
	});

	it("formats footer labels for key lifecycle states", () => {
		const pending = parsePrViewJson(
			buildPrJson({
				statusCheckRollup: [{ __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: null }],
			}),
		);
		expect(formatFooterStatus(pending)).toBe("PR #123 ⏳ 1 pending");

		const merged = parsePrViewJson(buildPrJson({ mergedAt: "2026-04-08T22:03:00Z", state: "MERGED" }));
		expect(formatFooterStatus(merged)).toBe("PR #123 ✓ merged");
	});
});
