import type { PrSnapshot } from "./github.js";

export type PrEventLevel = "info" | "warning" | "error" | "success";

export type PrAnnouncement = {
	key: string;
	level: PrEventLevel;
	text: string;
};

export function getPollIntervalMs(snapshot: PrSnapshot | null): number | null {
	if (!snapshot) return 30_000;
	if (snapshot.lifecycle === "merged" || snapshot.lifecycle === "closed") return null;
	if (snapshot.lifecycle === "checks_pending") return 5_000;
	return 30_000;
}

export function stabilizeSnapshot(previous: PrSnapshot | null, next: PrSnapshot): PrSnapshot {
	if (next.lifecycle !== "checks_passed") return next;
	if (!previous) {
		return { ...next, lifecycle: "open" };
	}
	if (previous.lifecycle === "checks_pending" || previous.lifecycle === "checks_failed" || previous.lifecycle === "checks_passed") {
		return next;
	}
	if (previous.checks.total > 0) {
		return next;
	}
	return { ...next, lifecycle: "open" };
}

export function getAnnouncementKey(snapshot: PrSnapshot): string {
	const failing = snapshot.checks.failing.join(",");
	return [snapshot.lifecycle, snapshot.prNumber, failing, snapshot.mergedAt ?? "", snapshot.updatedAt ?? ""].join("|");
}

function hasLifecycleChanged(previous: PrSnapshot | null, next: PrSnapshot): boolean {
	return previous?.lifecycle !== next.lifecycle;
}

export function getAnnouncement(
	previous: PrSnapshot | null,
	next: PrSnapshot,
	lastAnnouncedKey: string | null,
): PrAnnouncement | null {
	const key = getAnnouncementKey(next);
	if (lastAnnouncedKey === key) return null;

	if (!previous) {
		return {
			key,
			level: "info",
			text: `Tracking PR #${next.prNumber}: ${next.title}`,
		};
	}

	if (next.lifecycle === "checks_failed") {
		if (!hasLifecycleChanged(previous, next) && previous.checks.failing.join(",") === next.checks.failing.join(",")) {
			return null;
		}
		const failing = next.checks.failing.join(", ");
		return {
			key,
			level: "error",
			text: `PR #${next.prNumber}: CI failed${failing ? ` (${failing})` : ""}`,
		};
	}

	if (next.lifecycle === "checks_passed" && previous.lifecycle !== "checks_passed") {
		return {
			key,
			level: "success",
			text: `PR #${next.prNumber}: all required checks passed`,
		};
	}

	if (next.lifecycle === "merge_conflict" && previous.lifecycle !== "merge_conflict") {
		return {
			key,
			level: "warning",
			text: `PR #${next.prNumber}: merge conflict detected`,
		};
	}

	if (previous.lifecycle === "merge_conflict" && next.lifecycle !== "merge_conflict") {
		return {
			key,
			level: "success",
			text: `PR #${next.prNumber}: merge conflict cleared`,
		};
	}

	if (next.lifecycle === "merged" && previous.lifecycle !== "merged") {
		return {
			key,
			level: "success",
			text: `PR #${next.prNumber}: merged successfully`,
		};
	}

	if (next.lifecycle === "closed" && previous.lifecycle !== "closed") {
		return {
			key,
			level: "warning",
			text: `PR #${next.prNumber}: closed without merge`,
		};
	}

	return null;
}
