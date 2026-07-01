export type StepId = "branch" | "commit" | "push" | "pr" | "ci" | "merge" | "return";
export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped" | "cancelled";
export type CheckStatus = "pending" | "passed" | "failed" | "skipped";

export interface WorkflowStep {
	id: StepId;
	label: string;
	status: StepStatus;
	detail?: string;
}

export interface ChangedFile {
	status: string;
	path: string;
	previousPath?: string;
}

export interface GitHubCheck {
	name: string;
	workflow?: string;
	bucket?: string;
	state?: string;
	link?: string;
	description?: string;
	startedAt?: string;
	completedAt?: string;
}

export interface DisplayCheck extends GitHubCheck {
	status: CheckStatus;
}

export interface CheckEvaluation {
	status: "pending" | "passed" | "failed";
	hasNonSkipped: boolean;
	passed: DisplayCheck[];
	failed: DisplayCheck[];
	pending: DisplayCheck[];
	skipped: DisplayCheck[];
}

export interface CommandFailure {
	step: string;
	command?: string;
	args?: string[];
	cwd?: string;
	code?: number;
	stdout?: string;
	stderr?: string;
	message?: string;
}


const CONVENTIONAL_BRANCH_PREFIXES = new Set([
	"feat",
	"fix",
	"chore",
	"docs",
	"test",
	"refactor",
	"perf",
	"ci",
	"build",
	"style",
	"revert",
]);

const CONVENTIONAL_COMMIT_TYPES = new Set([
	"feat",
	"fix",
	"chore",
	"docs",
	"test",
	"refactor",
	"perf",
	"ci",
	"build",
	"style",
	"revert",
]);

export const DEFAULT_STEPS: WorkflowStep[] = [
	{ id: "branch", label: "Branch", status: "pending" },
	{ id: "commit", label: "Commit", status: "pending" },
	{ id: "push", label: "Push", status: "pending" },
	{ id: "pr", label: "Pull Request", status: "pending" },
	{ id: "ci", label: "CI Checks", status: "pending" },
	{ id: "merge", label: "Merge", status: "pending" },
	{ id: "return", label: "Return", status: "pending" },
];

export function cloneDefaultSteps(): WorkflowStep[] {
	return DEFAULT_STEPS.map((step) => ({ ...step }));
}

export function hasDirtyFiles(statusPorcelain: string): boolean {
	return statusPorcelain
		.split("\n")
		.some((line) => line.trim().length > 0);
}

export function sanitizeBranchName(raw: string, fallback = "chore/productionize"): string {
	const candidate = firstMeaningfulLine(raw)
		.replace(/^refs\/heads\//i, "")
		.replace(/^feature\//i, "feat/")
		.toLowerCase();

	const parts = candidate
		.split("/")
		.map(sanitizeBranchSegment)
		.filter((part) => part.length > 0);

	let prefix = parts[0];
	let slugParts = parts.slice(1);
	if (!prefix || !CONVENTIONAL_BRANCH_PREFIXES.has(prefix)) {
		prefix = "chore";
		slugParts = parts;
	}

	let slug = slugParts.join("-");
	if (!slug) slug = sanitizeBranchSegment(fallback.split("/").pop() ?? "productionize");
	if (!slug) slug = "productionize";

	let branch = `${prefix}/${slug}`.replace(/\/{2,}/g, "/").slice(0, 80);
	branch = branch.replace(/[/.\-]+$/g, "");
	if (!branch.includes("/")) branch = `${prefix}/productionize`;
	if (branch === "main" || branch === "master" || branch.endsWith("/main") || branch.endsWith("/master")) {
		branch = "chore/productionize";
	}
	return branch;
}

export function sanitizeCommitSubject(raw: string, fallback = "chore: productionize changes"): string {
	let subject = sanitizeOneLine(raw, fallback, 72);
	if (!isConventionalCommitSubject(subject)) {
		subject = sanitizeOneLine(`chore: ${subject}`, fallback, 72);
	}
	return subject;
}

export function sanitizePrTitle(raw: string, fallback = "Productionize changes"): string {
	return sanitizeOneLine(raw, fallback, 120);
}

export function parseNameStatus(output: string): ChangedFile[] {
	return output
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const parts = line.split("\t");
			const status = parts[0] ?? "M";
			if (status.startsWith("R") || status.startsWith("C")) {
				return { status, previousPath: parts[1] ?? "", path: parts[2] ?? parts[1] ?? "" };
			}
			return { status, path: parts[1] ?? parts[0] ?? "" };
		})
		.filter((file) => file.path.length > 0)
		.sort(compareChangedFiles);
}

export function formatChangedFilesByDirectory(files: ChangedFile[]): string {
	if (files.length === 0) return "No changed files detected.";

	const groups = new Map<string, ChangedFile[]>();
	for (const file of [...files].sort(compareChangedFiles)) {
		const directory = topLevelDirectory(file.path);
		const group = groups.get(directory) ?? [];
		group.push(file);
		groups.set(directory, group);
	}

	const directories = Array.from(groups.keys()).sort((a, b) => {
		if (a === ".") return -1;
		if (b === ".") return 1;
		return a.localeCompare(b);
	});

	const lines: string[] = [];
	for (const directory of directories) {
		lines.push(`### ${directory}`);
		for (const file of groups.get(directory) ?? []) {
			const label = humanStatus(file.status);
			const pathText = file.previousPath ? `\`${file.previousPath}\` → \`${file.path}\`` : `\`${file.path}\``;
			lines.push(`- ${label}: ${pathText}`);
		}
		lines.push("");
	}
	return lines.join("\n").trimEnd();
}

export function hasPrChanges(files: ChangedFile[], commitCount: number): boolean {
	return files.length > 0 || commitCount > 0;
}

export function buildPrBody(files: ChangedFile[], options: { branch: string; base: string; generatedAt?: Date }): string {
	const generatedAt = options.generatedAt ?? new Date();
	return [
		"## Summary",
		"",
		"Prepared by Pi `/productionize`.",
		"",
		"## Branch",
		"",
		`- Head: \`${options.branch}\``,
		`- Base: \`${options.base}\``,
		"",
		"## Changed files",
		"",
		formatChangedFilesByDirectory(files),
		"",
		"## Productionize metadata",
		"",
		`- Generated at: ${generatedAt.toISOString()}`,
	].join("\n");
}

export function classifyCheck(check: GitHubCheck): CheckStatus {
	const bucketStatus = classifyCheckToken(check.bucket, "bucket");
	if (bucketStatus) return bucketStatus;

	return classifyCheckToken(check.state, "state") ?? "pending";
}

function classifyCheckToken(value: string | undefined, source: "bucket" | "state"): CheckStatus | undefined {
	const token = (value ?? "").toLowerCase();
	if (!token) return undefined;

	if (/\b(fail|failure|error|cancel|cancelled|timed_out|action_required)\b/.test(token)) return "failed";
	if (/\b(skip|skipped|skipping|neutral)\b/.test(token)) return "skipped";
	if (/\b(pass|success|successful)\b/.test(token)) return "passed";
	if (source === "bucket" && /\bpending\b/.test(token)) return "pending";
	return undefined;
}

export function evaluateChecks(checks: GitHubCheck[]): CheckEvaluation {
	const display = checks
		.map((check) => ({ ...check, status: classifyCheck(check) }))
		.sort((a, b) => checkLabel(a).localeCompare(checkLabel(b)));
	const passed = display.filter((check) => check.status === "passed");
	const failed = display.filter((check) => check.status === "failed");
	const pending = display.filter((check) => check.status === "pending");
	const skipped = display.filter((check) => check.status === "skipped");
	const hasNonSkipped = display.some((check) => check.status !== "skipped");

	if (failed.length > 0) return { status: "failed", hasNonSkipped, passed, failed, pending, skipped };
	if (hasNonSkipped && pending.length === 0) return { status: "passed", hasNonSkipped, passed, failed, pending, skipped };
	return { status: "pending", hasNonSkipped, passed, failed, pending, skipped };
}

export function checkLabel(check: GitHubCheck): string {
	return check.workflow ? `${check.workflow} / ${check.name}` : check.name;
}

export function isLikelyNoPr(stdout: string, stderr: string): boolean {
	const text = `${stdout}\n${stderr}`.toLowerCase();
	return text.includes("no pull requests") || text.includes("no open pull requests") || text.includes("not found");
}

export function isLikelyNoChecks(stdout: string, stderr: string): boolean {
	const trimmedStdout = stdout.trim();
	const stdoutIsJson = trimmedStdout.startsWith("[") || trimmedStdout.startsWith("{");
	if (stdoutIsJson) return false;
	const text = `${stdout}\n${stderr}`.toLowerCase();
	return text.includes("no checks reported") || text.includes("no check runs") || text.includes("no status checks");
}

export function parseBranchUsedByWorktreeError(stdout: string, stderr: string): { branch: string; path: string } | undefined {
	const match = `${stdout}\n${stderr}`.match(/fatal:\s*'([^']+)'\s+is already used by worktree at\s+'([^']+)'/s);
	if (!match) return undefined;
	return { branch: match[1], path: match[2] };
}

export function isLikelyNonFastForwardPull(stdout: string, stderr: string): boolean {
	const text = `${stdout}\n${stderr}`;
	return /^fatal: Not possible to fast-forward, aborting\.$/m.test(text);
}

function sanitizeOneLine(raw: string, fallback: string, maxLength: number): string {
	const line = firstMeaningfulLine(raw)
		.replace(/[\u0000-\u001f\u007f]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
	const value = line || fallback;
	const truncated = value.length > maxLength ? value.slice(0, maxLength).replace(/[\s:;,.\-]+$/g, "") : value;
	return truncated || fallback;
}

function firstMeaningfulLine(raw: string): string {
	for (const line of raw.split(/\r?\n/)) {
		const cleaned = line
			.trim()
			.replace(/^```[a-zA-Z]*\s*/, "")
			.replace(/```$/g, "")
			.replace(/^[-*]\s+/, "")
			.replace(/^branch(?: name)?:/i, "")
			.replace(/^commit(?: message)?:/i, "")
			.replace(/^pr title:/i, "")
			.replace(/^["'`]+|["'`]+$/g, "")
			.trim();
		if (cleaned) return cleaned;
	}
	return "";
}

function sanitizeBranchSegment(value: string): string {
	return value
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/_/g, "-")
		.replace(/[^a-z0-9.-]+/g, "-")
		.replace(/\.+/g, ".")
		.replace(/-+/g, "-")
		.replace(/^[.-]+|[.-]+$/g, "");
}

function isConventionalCommitSubject(subject: string): boolean {
	const match = subject.match(/^([a-z]+)(\([^)]+\))?!?:\s+\S/);
	return match ? CONVENTIONAL_COMMIT_TYPES.has(match[1]) : false;
}

function topLevelDirectory(path: string): string {
	const first = path.split("/")[0];
	return path.includes("/") && first ? first : ".";
}

function compareChangedFiles(a: ChangedFile, b: ChangedFile): number {
	const directoryCompare = topLevelDirectory(a.path).localeCompare(topLevelDirectory(b.path));
	if (directoryCompare !== 0) return directoryCompare;
	return a.path.localeCompare(b.path);
}

function humanStatus(status: string): string {
	const code = status[0]?.toUpperCase();
	switch (code) {
		case "A":
			return "added";
		case "M":
			return "modified";
		case "D":
			return "deleted";
		case "R":
			return "renamed";
		case "C":
			return "copied";
		case "T":
			return "type changed";
		default:
			return status || "changed";
	}
}
