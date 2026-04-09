export type PrLifecycle =
	| "open"
	| "checks_pending"
	| "checks_failed"
	| "checks_passed"
	| "merge_conflict"
	| "merged"
	| "closed";

export type PrChecksSummary = {
	total: number;
	pending: number;
	successful: number;
	failing: string[];
};

export type PrSnapshot = {
	repo: string;
	prNumber: number;
	title: string;
	url: string;
	headRefName: string;
	baseRefName: string;
	isDraft: boolean;
	updatedAt: string | null;
	mergedAt: string | null;
	mergeable: string | null;
	mergeStateStatus: string | null;
	checks: PrChecksSummary;
	lifecycle: PrLifecycle;
};

type RollupItem = {
	__typename?: string;
	name?: string;
	context?: string;
	status?: string | null;
	conclusion?: string | null;
	state?: string | null;
};

type RawPrView = {
	number: number;
	title: string;
	url: string;
	state: string;
	isDraft: boolean;
	mergedAt: string | null;
	mergeable: string | null;
	mergeStateStatus: string | null;
	statusCheckRollup?: RollupItem[] | null;
	headRefName: string;
	baseRefName: string;
	updatedAt: string | null;
};

function parseRepoFromUrl(url: string): string {
	const match = url.match(/^https?:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+/i);
	if (!match) {
		throw new Error(`Could not parse repo from PR url: ${url}`);
	}
	return match[1]!;
}

function getRollupName(item: RollupItem): string {
	return item.name?.trim() || item.context?.trim() || item.__typename || "unknown";
}

function isFailing(item: RollupItem): boolean {
	const conclusion = item.conclusion?.toUpperCase();
	const state = item.state?.toUpperCase();
	return conclusion === "FAILURE" || conclusion === "TIMED_OUT" || conclusion === "CANCELLED" || state === "FAILURE" || state === "ERROR";
}

function isPending(item: RollupItem): boolean {
	const status = item.status?.toUpperCase();
	const state = item.state?.toUpperCase();
	return status === "IN_PROGRESS" || status === "QUEUED" || state === "PENDING";
}

function isSuccessful(item: RollupItem): boolean {
	const conclusion = item.conclusion?.toUpperCase();
	const state = item.state?.toUpperCase();
	return conclusion === "SUCCESS" || state === "SUCCESS";
}

function summarizeChecks(statusCheckRollup: RollupItem[] | null | undefined): PrChecksSummary {
	const items = Array.isArray(statusCheckRollup) ? statusCheckRollup : [];
	const failing = items.filter(isFailing).map(getRollupName).sort((a, b) => a.localeCompare(b));
	const pending = items.filter(isPending).length;
	const successful = items.filter(isSuccessful).length;

	return {
		total: items.length,
		pending,
		successful,
		failing,
	};
}

function isConflict(raw: RawPrView): boolean {
	return raw.mergeable?.toUpperCase() === "CONFLICTING" || raw.mergeStateStatus?.toUpperCase() === "DIRTY";
}

function deriveLifecycle(raw: RawPrView, checks: PrChecksSummary): PrLifecycle {
	if (raw.mergedAt) return "merged";
	if (raw.state.toUpperCase() === "CLOSED") return "closed";
	if (isConflict(raw)) return "merge_conflict";
	if (checks.failing.length > 0) return "checks_failed";
	if (checks.pending > 0) return "checks_pending";
	if (checks.total > 0 && checks.successful === checks.total) return "checks_passed";
	return "open";
}

export function parsePrViewJson(stdout: string): PrSnapshot {
	const raw = JSON.parse(stdout) as RawPrView;
	const checks = summarizeChecks(raw.statusCheckRollup);

	return {
		repo: parseRepoFromUrl(raw.url),
		prNumber: raw.number,
		title: raw.title,
		url: raw.url,
		headRefName: raw.headRefName,
		baseRefName: raw.baseRefName,
		isDraft: raw.isDraft,
		updatedAt: raw.updatedAt,
		mergedAt: raw.mergedAt,
		mergeable: raw.mergeable,
		mergeStateStatus: raw.mergeStateStatus,
		checks,
		lifecycle: deriveLifecycle(raw, checks),
	};
}

export function formatFooterStatus(snapshot: PrSnapshot): string {
	switch (snapshot.lifecycle) {
		case "checks_pending":
			return `PR #${snapshot.prNumber} ⏳ ${snapshot.checks.pending} pending`;
		case "checks_failed":
			return `PR #${snapshot.prNumber} ✗ ${snapshot.checks.failing.length} failing`;
		case "checks_passed":
			return `PR #${snapshot.prNumber} ✓ checks passed`;
		case "merge_conflict":
			return `PR #${snapshot.prNumber} ⚠ conflict`;
		case "merged":
			return `PR #${snapshot.prNumber} ✓ merged`;
		case "closed":
			return `PR #${snapshot.prNumber} • closed`;
		case "open":
			return `PR #${snapshot.prNumber} • open`;
	}
}
