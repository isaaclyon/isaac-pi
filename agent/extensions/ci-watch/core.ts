export type CheckBucket = "pass" | "fail" | "pending" | "skipping" | "cancel" | string;

export interface PrInfo {
	number: number;
	title: string;
	url: string;
	headRefName: string;
	headRefOid: string;
}

export interface CheckInfo {
	name: string;
	workflow?: string;
	bucket: CheckBucket;
	state: string;
	link?: string;
	description?: string;
	startedAt?: string;
	completedAt?: string;
}

export interface ExecCall {
	command: string;
	args: string[];
	cwd: string;
	timeoutMs: number;
	signal?: AbortSignal;
}

export interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
	killed?: boolean;
}

export interface SendUserMessageOptions {
	deliverAs?: "followUp";
}

export interface CiWatchDeps {
	cwd: string;
	exec: (call: ExecCall) => Promise<ExecResult>;
	isIdle: () => boolean;
	sendUserMessage: (message: string, options?: SendUserMessageOptions) => void;
	notify: (message: string, level: "info" | "warning" | "error" | "success") => void;
	appendState?: (data: CiWatchStateEntry) => void;
}

export interface CiWatchStateEntry {
	kind: "notified-failure";
	key: string;
	prNumber: number;
	headRefOid: string;
	checks: string[];
	timestamp: number;
}

export interface CiWatchOptions {
	pollIntervalMs: number;
	commandTimeoutMs: number;
	watchTimeoutMs: number;
	includeCancelled: boolean;
	requiredOnly: boolean;
}

export interface CiWatchStatus {
	running: boolean;
	pollInFlight: boolean;
	currentPr?: PrInfo;
	currentWatchKey?: string;
	lastError?: string;
	notifiedFailures: number;
}

const DEFAULT_OPTIONS: CiWatchOptions = {
	pollIntervalMs: 60_000,
	commandTimeoutMs: 30_000,
	watchTimeoutMs: 3 * 60 * 60 * 1000,
	includeCancelled: true,
	requiredOnly: false,
};

const PR_VIEW_FIELDS = "number,title,url,headRefName,headRefOid";
const PR_CHECK_FIELDS = "name,workflow,bucket,state,link,description,startedAt,completedAt";

export function getFailedChecks(
	checks: CheckInfo[],
	options: { includeCancelled: boolean },
): CheckInfo[] {
	return checks.filter((check) => check.bucket === "fail" || (options.includeCancelled && check.bucket === "cancel"));
}

export function buildFailureKey(pr: PrInfo, failedChecks: CheckInfo[]): string {
	const names = failedChecks.map((check) => check.name).sort((a, b) => a.localeCompare(b));
	return `${pr.number}:${pr.headRefOid}:${names.join(",")}`;
}

export function buildFailureMessage(pr: PrInfo, failedChecks: CheckInfo[]): string {
	const checkLines = failedChecks
		.map((check) => {
			const label = check.workflow ? `${check.workflow} / ${check.name}` : check.name;
			return check.link ? `- ${label}: ${check.link}` : `- ${label}`;
		})
		.join("\n");

	return `CI failed for PR #${pr.number}: ${pr.title}\n${pr.url}\n\nFailed checks:\n${checkLines}\n\nPlease inspect the failure and propose the smallest fix.`;
}

export function watchKeyForPr(pr: PrInfo): string {
	return `${pr.number}:${pr.headRefOid}`;
}

function parseJson<T>(stdout: string, label: string): T {
	try {
		return JSON.parse(stdout) as T;
	} catch (error) {
		throw new Error(`Could not parse ${label} JSON: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function isLikelyNoPr(result: ExecResult): boolean {
	const text = `${result.stderr}\n${result.stdout}`.toLowerCase();
	return text.includes("no pull requests") || text.includes("not found") || text.includes("could not find");
}

export class CiWatchController {
	private readonly deps: CiWatchDeps;
	private readonly options: CiWatchOptions;
	private timer: ReturnType<typeof setInterval> | undefined;
	private pollInFlight = false;
	private watchController: AbortController | undefined;
	private currentWatchPromise: Promise<void> | undefined;
	private currentWatchKey: string | undefined;
	private currentPr: PrInfo | undefined;
	private lastError: string | undefined;
	private readonly notifiedFailureKeys = new Set<string>();
	private readonly notifiedOperationalErrors = new Set<string>();

	constructor(deps: CiWatchDeps, options: Partial<CiWatchOptions> = {}, restoredFailureKeys: Iterable<string> = []) {
		this.deps = deps;
		this.options = { ...DEFAULT_OPTIONS, ...options };
		for (const key of restoredFailureKeys) this.notifiedFailureKeys.add(key);
	}

	start(): void {
		if (this.timer) return;
		this.timer = setInterval(() => {
			void this.pollNow();
		}, this.options.pollIntervalMs);
		void this.pollNow();
	}

	stop(): void {
		if (this.timer) {
			clearInterval(this.timer);
			this.timer = undefined;
		}
		this.watchController?.abort();
		this.watchController = undefined;
		this.currentWatchPromise = undefined;
		this.currentWatchKey = undefined;
	}

	status(): CiWatchStatus {
		return {
			running: this.timer !== undefined,
			pollInFlight: this.pollInFlight,
			currentPr: this.currentPr,
			currentWatchKey: this.currentWatchKey,
			lastError: this.lastError,
			notifiedFailures: this.notifiedFailureKeys.size,
		};
	}

	async pollNow(): Promise<void> {
		if (this.pollInFlight) return;
		this.pollInFlight = true;
		try {
			const pr = await this.fetchCurrentPr();
			this.currentPr = pr;
			if (!pr) return;
			this.startWatchForPr(pr);
		} catch (error) {
			this.recordOperationalError("poll", error);
		} finally {
			this.pollInFlight = false;
		}
	}

	async waitForCurrentWatch(): Promise<void> {
		await this.currentWatchPromise;
	}

	private async fetchCurrentPr(): Promise<PrInfo | undefined> {
		const result = await this.deps.exec({
			command: "gh",
			args: ["pr", "view", "--json", PR_VIEW_FIELDS],
			cwd: this.deps.cwd,
			timeoutMs: this.options.commandTimeoutMs,
		});

		if (result.code !== 0) {
			if (isLikelyNoPr(result)) return undefined;
			throw new Error(result.stderr.trim() || result.stdout.trim() || `gh pr view exited ${result.code}`);
		}

		return parseJson<PrInfo>(result.stdout, "PR");
	}

	private startWatchForPr(pr: PrInfo): void {
		const nextWatchKey = watchKeyForPr(pr);
		if (this.currentWatchKey === nextWatchKey) return;

		this.watchController?.abort();
		const controller = new AbortController();
		this.watchController = controller;
		this.currentWatchKey = nextWatchKey;
		this.deps.notify(`Watching CI for PR #${pr.number} (${pr.headRefName})`, "info");

		this.currentWatchPromise = this.runWatch(pr, controller).catch((error) => {
			if (!controller.signal.aborted) this.recordOperationalError("watch", error);
		});
	}

	private async runWatch(pr: PrInfo, controller: AbortController): Promise<void> {
		const watchResult = await this.deps.exec({
			command: "gh",
			args: ["pr", "checks", String(pr.number), "--watch", "--fail-fast"],
			cwd: this.deps.cwd,
			timeoutMs: this.options.watchTimeoutMs,
			signal: controller.signal,
		});

		if (controller.signal.aborted) return;
		if (watchResult.code === 0) return;

		const checks = await this.fetchChecks(pr.number, controller.signal);
		if (controller.signal.aborted) return;

		const failedChecks = getFailedChecks(checks, { includeCancelled: this.options.includeCancelled });
		if (failedChecks.length === 0) return;

		this.announceFailure(pr, failedChecks);
	}

	private async fetchChecks(prNumber: number, signal?: AbortSignal): Promise<CheckInfo[]> {
		const args = ["pr", "checks", String(prNumber)];
		if (this.options.requiredOnly) args.push("--required");
		args.push("--json", PR_CHECK_FIELDS);

		const result = await this.deps.exec({
			command: "gh",
			args,
			cwd: this.deps.cwd,
			timeoutMs: this.options.commandTimeoutMs,
			signal,
		});

		if (result.code !== 0) {
			throw new Error(result.stderr.trim() || result.stdout.trim() || `gh pr checks exited ${result.code}`);
		}

		return parseJson<CheckInfo[]>(result.stdout, "checks");
	}

	private announceFailure(pr: PrInfo, failedChecks: CheckInfo[]): void {
		const key = buildFailureKey(pr, failedChecks);
		if (this.notifiedFailureKeys.has(key)) return;

		this.notifiedFailureKeys.add(key);
		this.deps.appendState?.({
			kind: "notified-failure",
			key,
			prNumber: pr.number,
			headRefOid: pr.headRefOid,
			checks: failedChecks.map((check) => check.name).sort((a, b) => a.localeCompare(b)),
			timestamp: Date.now(),
		});

		const message = buildFailureMessage(pr, failedChecks);
		if (this.deps.isIdle()) {
			this.deps.sendUserMessage(message);
		} else {
			this.deps.sendUserMessage(message, { deliverAs: "followUp" });
		}
	}

	private recordOperationalError(scope: string, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.lastError = message;
		const key = `${scope}:${message}`;
		if (this.notifiedOperationalErrors.has(key)) return;
		this.notifiedOperationalErrors.add(key);
		this.deps.notify(`CI watch ${scope} error: ${message}`, "warning");
	}
}
