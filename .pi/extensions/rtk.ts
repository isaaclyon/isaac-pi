import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	isBashToolResult,
	isGrepToolResult,
	isReadToolResult,
} from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, resolve } from "node:path";

type FilterLevel = "none" | "minimal" | "aggressive";

interface RtkConfig {
	enabled: boolean;
	logSavings: boolean;
	showUpdateEvery: number;
	techniques: {
		ansiStripping: boolean;
		truncation: { enabled: boolean; maxChars: number };
		sourceCodeFiltering: FilterLevel;
		smartTruncation: { enabled: boolean; maxLines: number };
		testOutputAggregation: boolean;
		buildOutputFiltering: boolean;
		gitCompaction: boolean;
		searchResultGrouping: boolean;
		linterAggregation: boolean;
	};
}

interface MetricRecord {
	tool: "bash" | "read" | "grep";
	techniques: string[];
	originalChars: number;
	filteredChars: number;
	timestamp: string;
}

const DEFAULT_CONFIG: RtkConfig = {
	enabled: true,
	logSavings: true,
	showUpdateEvery: 10,
	techniques: {
		ansiStripping: true,
		truncation: { enabled: true, maxChars: 10_000 },
		sourceCodeFiltering: "minimal",
		smartTruncation: { enabled: true, maxLines: 220 },
		testOutputAggregation: true,
		buildOutputFiltering: true,
		gitCompaction: true,
		searchResultGrouping: true,
		linterAggregation: true,
	},
};

const BUILD_COMMAND_RE = [
	/\bcargo\s+(build|check)\b/i,
	/\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?build\b/i,
	/\btsc\b/i,
	/\b(?:make|cmake|gradle|mvn|go\s+build)\b/i,
];

const TEST_COMMAND_RE = [
	/\b(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?test\b/i,
	/\b(?:vitest|jest|pytest|cargo\s+test|go\s+test|mocha|ava)\b/i,
];

const GIT_COMMAND_RE = [/^\s*git\s+status\b/i, /^\s*git\s+diff\b/i, /^\s*git\s+log\b/i];

const LINT_COMMAND_RE = [
	/\beslint\b/i,
	/\b(?:ruff|pylint|mypy|flake8|clippy|golangci-lint|prettier)\b/i,
];

const SEARCH_COMMAND_RE = [/\b(?:rg|grep|ag|ack)\b/i];

const STRUCTURED_OUTPUT_FLAG_RE =
	/(--json\b|--reporter(?:=|\s+)json\b|--reporter(?:=|\s+)(?:junit|tap)\b|--tap\b|--junit\b|--output-?format(?:=|\s+)json\b|--format(?:=|\s+)json\b)/i;

const LANGUAGE_BY_EXT: Record<string, "js" | "py" | "rs" | "go" | "java" | "c" | "cpp" | "unknown"> = {
	".ts": "js",
	".tsx": "js",
	".mts": "js",
	".cts": "js",
	".js": "js",
	".jsx": "js",
	".mjs": "js",
	".cjs": "js",
	".py": "py",
	".rs": "rs",
	".go": "go",
	".java": "java",
	".c": "c",
	".h": "c",
	".cc": "cpp",
	".cpp": "cpp",
	".cxx": "cpp",
	".hpp": "cpp",
	".hh": "cpp",
};

function mergeConfig(base: RtkConfig, override: Partial<RtkConfig>): RtkConfig {
	return {
		...base,
		...override,
		showUpdateEvery:
			typeof override.showUpdateEvery === "number" && Number.isFinite(override.showUpdateEvery)
				? Math.max(0, Math.floor(override.showUpdateEvery))
				: base.showUpdateEvery,
		techniques: {
			...base.techniques,
			...(override.techniques ?? {}),
			truncation: {
				...base.techniques.truncation,
				...(override.techniques?.truncation ?? {}),
			},
			smartTruncation: {
				...base.techniques.smartTruncation,
				...(override.techniques?.smartTruncation ?? {}),
			},
		},
	};
}

async function loadConfig(cwd: string): Promise<RtkConfig> {
	const paths = [resolve(cwd, ".pi", "rtk-config.json"), resolve(homedir(), ".pi", "agent", "rtk-config.json")];

	for (const configPath of paths) {
		try {
			const raw = await readFile(configPath, "utf8");
			const parsed = JSON.parse(raw) as Partial<RtkConfig>;
			return mergeConfig(DEFAULT_CONFIG, parsed);
		} catch {
			// no-op, continue
		}
	}

	return DEFAULT_CONFIG;
}

function stripAnsi(text: string): string {
	if (!text.includes("\u001b")) return text;
	// eslint-disable-next-line no-control-regex
	return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, "");
}

function truncateChars(text: string, maxChars: number): string {
	if (text.length <= maxChars) return text;
	if (maxChars < 16) return `${text.slice(0, Math.max(0, maxChars - 3))}...`;

	const head = Math.floor(maxChars * 0.65);
	const tail = Math.max(0, maxChars - head - 48);
	return `${text.slice(0, head)}\n\n... [truncated ${text.length - maxChars} chars] ...\n\n${text.slice(-tail)}`;
}

function collapseBlankLines(lines: string[]): string[] {
	const out: string[] = [];
	let lastBlank = false;
	for (const line of lines) {
		const blank = line.trim().length === 0;
		if (blank && lastBlank) continue;
		out.push(blank ? "" : line);
		lastBlank = blank;
	}
	return out;
}

function detectLanguage(filePath: string): keyof typeof COMMENT_TOKENS {
	const ext = extname(filePath).toLowerCase();
	return LANGUAGE_BY_EXT[ext] ?? "unknown";
}

const COMMENT_TOKENS: Record<string, { line?: string; blockStart?: string; blockEnd?: string }> = {
	js: { line: "//", blockStart: "/*", blockEnd: "*/" },
	py: { line: "#" },
	rs: { line: "//", blockStart: "/*", blockEnd: "*/" },
	go: { line: "//", blockStart: "/*", blockEnd: "*/" },
	java: { line: "//", blockStart: "/*", blockEnd: "*/" },
	c: { line: "//", blockStart: "/*", blockEnd: "*/" },
	cpp: { line: "//", blockStart: "/*", blockEnd: "*/" },
	unknown: {},
};

function filterSourceMinimal(content: string, language: keyof typeof COMMENT_TOKENS): string {
	if (language === "unknown") return content;

	const tokens = COMMENT_TOKENS[language];
	const lines = content.split("\n");
	const out: string[] = [];
	let inBlock = false;

	for (const rawLine of lines) {
		const line = rawLine.replace(/[\t ]+$/g, "");
		const trimmed = line.trim();

		if (tokens.blockStart && tokens.blockEnd) {
			if (!inBlock && trimmed.startsWith(tokens.blockStart) && !trimmed.includes(tokens.blockEnd)) {
				inBlock = true;
				continue;
			}
			if (inBlock) {
				if (trimmed.includes(tokens.blockEnd)) {
					inBlock = false;
				}
				continue;
			}
			if (trimmed.startsWith(tokens.blockStart) && trimmed.endsWith(tokens.blockEnd)) {
				continue;
			}
		}

		if (tokens.line && trimmed.startsWith(tokens.line)) {
			continue;
		}

		out.push(line);
	}

	return collapseBlankLines(out).join("\n").trim();
}

function filterSourceAggressive(content: string, language: keyof typeof COMMENT_TOKENS): string {
	const minimal = filterSourceMinimal(content, language);
	const lines = minimal.split("\n");
	const out: string[] = [];
	const keepLine =
		/^(import\b|export\b|from\b|type\b|interface\b|class\b|enum\b|struct\b|trait\b|fn\b|def\b|function\b|const\b|let\b|var\b|use\b|#include\b)/;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (keepLine.test(trimmed) || trimmed === "{" || trimmed === "}" || trimmed.endsWith("{")) {
			out.push(line);
		}
	}

	return collapseBlankLines(out).join("\n").trim();
}

function smartTruncateSource(content: string, maxLines: number): string {
	const lines = content.split("\n");
	if (lines.length <= maxLines) return content;

	const headCount = Math.max(24, Math.floor(maxLines * 0.35));
	const tailCount = Math.max(18, Math.floor(maxLines * 0.2));
	const middleBudget = Math.max(0, maxLines - headCount - tailCount - 2);
	const importantRe = /\b(import|export|class|interface|type|function|fn|def|const|let|var|use|#include)\b/;

	const middle = lines.slice(headCount, Math.max(headCount, lines.length - tailCount));
	const important: string[] = [];
	for (const line of middle) {
		if (importantRe.test(line.trim())) important.push(line);
		if (important.length >= middleBudget) break;
	}

	const omitted = lines.length - headCount - tailCount - important.length;
	const marker = `... [${Math.max(0, omitted)} lines omitted] ...`;

	return [
		...lines.slice(0, headCount),
		marker,
		...important,
		"... [tail] ...",
		...lines.slice(-tailCount),
	].join("\n");
}

function isBuildCommand(command: string): boolean {
	return BUILD_COMMAND_RE.some((re) => re.test(command));
}

function isTestCommand(command: string): boolean {
	return TEST_COMMAND_RE.some((re) => re.test(command));
}

function isGitCommand(command: string): boolean {
	return GIT_COMMAND_RE.some((re) => re.test(command));
}

function isLinterCommand(command: string): boolean {
	return LINT_COMMAND_RE.some((re) => re.test(command));
}

function isSearchCommand(command: string): boolean {
	return SEARCH_COMMAND_RE.some((re) => re.test(command));
}

function looksLikeJsonDocument(text: string): boolean {
	const trimmed = text.trim();
	if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) return false;
	try {
		JSON.parse(trimmed);
		return true;
	} catch {
		return false;
	}
}

function shouldPreserveStructuredOutput(command: string, output: string): boolean {
	if (STRUCTURED_OUTPUT_FLAG_RE.test(command)) return true;
	return looksLikeJsonDocument(output);
}

function filterBuildOutput(text: string): string {
	const lines = text.split("\n");
	const keep = lines.filter((line) => {
		const t = line.trim();
		if (!t) return false;
		if (/^(error|warning|warn|fatal|failed|panic|exception)\b/i.test(t)) return true;
		if (/\bnpm\s+(?:ERR!|error)\b/i.test(t)) return true;
		if (/\bmissing script\b/i.test(t)) return true;
		if (/\b(error|warning)s?\b/i.test(t) && /\d/.test(t)) return true;
		if (/^(\s*-->\s|\s*\|\s|\s*\^)/.test(line)) return true;
		if (/\b(Build failed|Finished|Done|Compiled|built in)\b/i.test(t)) return true;
		return false;
	});

	if (keep.length === 0) {
		const errorish = lines.filter((line) =>
			/\b(error|fatal|failed|exception|panic|npm\s+(?:ERR!|error)|missing script)\b/i.test(line),
		);
		if (errorish.length > 0) {
			const sample = errorish.slice(0, 40);
			if (errorish.length > sample.length) sample.push(`... [${errorish.length - sample.length} more error lines omitted]`);
			return ["⚠️ Build output compacted (possible errors detected)", ...sample].join("\n");
		}

		const successDetected = lines.some((line) =>
			/\b(Build successful|Build succeeded|Finished|Done|Compiled|built in|0 errors?)\b/i.test(line),
		);
		return successDetected
			? "✓ Build output compacted: no errors or warnings detected."
			: "Build output compacted.";
	}

	const limited = keep.slice(0, 120);
	if (keep.length > limited.length) {
		limited.push(`... [${keep.length - limited.length} more build lines omitted]`);
	}
	return limited.join("\n");
}

function summarizeTestOutput(text: string): string {
	const lines = text.split("\n");
	const summaryLine =
		lines.find((line) => /test result:/i.test(line)) ??
		lines.find((line) => /(\d+)\s+passed(?:,\s*(\d+)\s+failed)?/i.test(line));

	const failures: string[] = [];
	let inFailure = false;
	for (const line of lines) {
		if (/^(FAIL|FAILED|\s*●|\s*✕|\s*✗)\b/.test(line)) {
			inFailure = true;
			failures.push(line.trim());
			continue;
		}
		if (!inFailure) continue;
		if (!line.trim()) {
			inFailure = false;
			continue;
		}
		if (/^\s/.test(line)) {
			failures.push(line.trimEnd());
			if (failures.length >= 80) break;
		}
	}

	const out: string[] = ["📋 Test output compacted"];
	if (summaryLine) out.push(summaryLine.trim());
	if (failures.length > 0) {
		out.push("", "Failures:", ...failures.slice(0, 60));
		if (failures.length > 60) out.push(`... [${failures.length - 60} more failure lines omitted]`);
	}
	if (!summaryLine && failures.length === 0) {
		out.push("No explicit failures detected in output.");
	}
	return out.join("\n");
}

function summarizeLinterOutput(text: string): string {
	const lines = text.split("\n");
	const issueLines = lines.filter((line) => /:\d+(?::\d+)?:\s/.test(line));
	if (issueLines.length === 0) return "✓ Linter output compacted: no parseable issues.";

	const byFile = new Map<string, number>();
	for (const line of issueLines) {
		const match = line.match(/^(.+?):\d+(?::\d+)?:/);
		if (!match) continue;
		byFile.set(match[1], (byFile.get(match[1]) ?? 0) + 1);
	}

	const out: string[] = [`Linter: ${issueLines.length} issue(s) in ${byFile.size} file(s)`];
	for (const [file, count] of Array.from(byFile.entries()).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
		out.push(`- ${file} (${count})`);
	}
	out.push("", "Sample issues:", ...issueLines.slice(0, 25));
	if (issueLines.length > 25) {
		out.push(`... [${issueLines.length - 25} more issue lines omitted]`);
	}
	return out.join("\n");
}

function compactGitStatus(output: string): string {
	const lines = output.split("\n").filter(Boolean);
	const branch = lines.find((line) => line.startsWith("## "))?.slice(3).split("...")[0];

	let staged = 0;
	let modified = 0;
	let untracked = 0;
	const sample: string[] = [];

	for (const line of lines) {
		if (line.startsWith("## ")) continue;
		if (line.startsWith("?? ")) {
			untracked += 1;
		} else {
			const x = line[0] ?? " ";
			const y = line[1] ?? " ";
			if (x !== " ") staged += 1;
			if (y !== " ") modified += 1;
		}
		if (sample.length < 20) sample.push(line);
	}

	const title = branch ? `Git status (${branch})` : "Git status";
	return [
		title,
		`staged=${staged}, modified=${modified}, untracked=${untracked}`,
		"",
		...sample,
		...(lines.length > sample.length ? [`... [${lines.length - sample.length} more status lines omitted]`] : []),
	].join("\n");
}

function compactGitDiff(output: string): string {
	const lines = output.split("\n");
	const perFile = new Map<string, { added: number; removed: number; hunks: number }>();
	let file = "";

	for (const line of lines) {
		if (line.startsWith("diff --git ")) {
			const match = line.match(/ b\/(.+)$/);
			file = match?.[1] ?? "unknown";
			if (!perFile.has(file)) perFile.set(file, { added: 0, removed: 0, hunks: 0 });
			continue;
		}
		if (!file) continue;
		const current = perFile.get(file);
		if (!current) continue;
		if (line.startsWith("@@")) current.hunks += 1;
		if (line.startsWith("+") && !line.startsWith("+++")) current.added += 1;
		if (line.startsWith("-") && !line.startsWith("---")) current.removed += 1;
	}

	const rows = Array.from(perFile.entries()).slice(0, 40);
	const out = ["Git diff summary", "file | +added | -removed | hunks", "---"];
	for (const [name, stats] of rows) {
		out.push(`${name} | +${stats.added} | -${stats.removed} | ${stats.hunks}`);
	}
	if (perFile.size > rows.length) {
		out.push(`... [${perFile.size - rows.length} more files omitted]`);
	}
	return out.join("\n");
}

function compactGitLog(output: string): string {
	const lines = output.split("\n").filter((line) => line.trim().length > 0);
	const keep = lines.slice(0, 30).map((line) => (line.length > 120 ? `${line.slice(0, 117)}...` : line));
	if (lines.length > keep.length) keep.push(`... [${lines.length - keep.length} more log lines omitted]`);
	return ["Git log compacted", "", ...keep].join("\n");
}

function compactGitOutput(command: string, output: string): string {
	if (/^\s*git\s+status\b/i.test(command)) return compactGitStatus(output);
	if (/^\s*git\s+diff\b/i.test(command)) return compactGitDiff(output);
	if (/^\s*git\s+log\b/i.test(command)) return compactGitLog(output);
	return output;
}

function groupSearchResults(output: string): string | null {
	const lines = output.split("\n");
	const byFile = new Map<string, Array<{ line: string; content: string }>>();

	for (const line of lines) {
		const match = line.match(/^(.+?):(\d+):(.*)$/);
		if (!match) continue;
		const [_, file, lineNo, content] = match;
		const list = byFile.get(file) ?? [];
		list.push({ line: lineNo, content: content.trim() });
		byFile.set(file, list);
	}

	if (byFile.size === 0) return null;

	const out: string[] = [];
	const sortedFiles = Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]));
	let shown = 0;

	for (const [file, matches] of sortedFiles) {
		out.push(`${file} (${matches.length})`);
		for (const match of matches.slice(0, 10)) {
			out.push(`  ${match.line}: ${match.content.slice(0, 180)}`);
			shown += 1;
		}
		if (matches.length > 10) out.push(`  ... [${matches.length - 10} more matches]`);
	}

	if (shown === 0) return null;
	return [`Search results grouped: ${shown} shown across ${byFile.size} file(s)`, "", ...out].join("\n");
}

function track(
	metrics: MetricRecord[],
	tool: MetricRecord["tool"],
	techniques: string[],
	before: string,
	after: string,
): void {
	metrics.push({
		tool,
		techniques,
		originalChars: before.length,
		filteredChars: after.length,
		timestamp: new Date().toISOString(),
	});
}

function metricsSummary(metrics: MetricRecord[]): string {
	if (metrics.length === 0) return "No RTK metrics recorded yet.";

	const totals = metrics.reduce(
		(acc, next) => {
			acc.original += next.originalChars;
			acc.filtered += next.filteredChars;
			return acc;
		},
		{ original: 0, filtered: 0 },
	);

	const saved = totals.original - totals.filtered;
	const pct = totals.original > 0 ? (saved / totals.original) * 100 : 0;
	const byTool = new Map<string, { calls: number; original: number; filtered: number }>();
	for (const m of metrics) {
		const current = byTool.get(m.tool) ?? { calls: 0, original: 0, filtered: 0 };
		current.calls += 1;
		current.original += m.originalChars;
		current.filtered += m.filteredChars;
		byTool.set(m.tool, current);
	}

	const lines = [
		"RTK token savings",
		`calls=${metrics.length}`,
		`original=${totals.original.toLocaleString()} chars`,
		`filtered=${totals.filtered.toLocaleString()} chars`,
		`saved=${saved.toLocaleString()} chars (${pct.toFixed(1)}%)`,
		"",
		"By tool:",
	];

	for (const [tool, row] of byTool.entries()) {
		const localPct = row.original > 0 ? ((row.original - row.filtered) / row.original) * 100 : 0;
		lines.push(`- ${tool}: ${row.calls} call(s), ${localPct.toFixed(1)}% saved`);
	}

	return lines.join("\n");
}

function applySourceFiltering(
	text: string,
	path: string,
	config: RtkConfig,
): { text: string; techniques: string[] } {
	const techniques: string[] = [];
	const language = detectLanguage(path);
	if (language === "unknown" || config.techniques.sourceCodeFiltering === "none") {
		return { text, techniques };
	}

	let next =
		config.techniques.sourceCodeFiltering === "aggressive"
			? filterSourceAggressive(text, language)
			: filterSourceMinimal(text, language);
	if (next !== text) techniques.push(`source:${config.techniques.sourceCodeFiltering}`);

	if (config.techniques.smartTruncation.enabled) {
		const lines = next.split("\n").length;
		if (lines > config.techniques.smartTruncation.maxLines) {
			next = smartTruncateSource(next, config.techniques.smartTruncation.maxLines);
			techniques.push("source:smart-truncate");
		}
	}

	return { text: next, techniques };
}

export default function rtk(pi: ExtensionAPI) {
	let config = DEFAULT_CONFIG;
	let enabled = config.enabled;
	const metrics: MetricRecord[] = [];
	let processedCount = 0;

	pi.on("session_start", async (_event, ctx) => {
		config = await loadConfig(ctx.cwd || process.cwd());
		enabled = config.enabled;
		if (ctx.hasUI && enabled) {
			ctx.ui.notify("RTK loaded: output reduction enabled", "info");
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!enabled) return;

		if (isBashToolResult(event)) {
			const command =
				typeof (event.input as { command?: unknown } | undefined)?.command === "string"
					? ((event.input as { command: string }).command ?? "")
					: "";
			const content = event.content;
			const item = content.find((entry) => entry.type === "text");
			if (!item || !("text" in item)) return;

			const before = item.text;
			let after = before;
			const techniques: string[] = [];

			if (config.techniques.ansiStripping) {
				const stripped = stripAnsi(after);
				if (stripped !== after) {
					after = stripped;
					techniques.push("ansi");
				}
			}

			const structuredOutput = command ? shouldPreserveStructuredOutput(command, after) : false;

			if (command && !structuredOutput && config.techniques.buildOutputFiltering && isBuildCommand(command)) {
				after = filterBuildOutput(after);
				techniques.push("build");
			}

			if (command && !structuredOutput && config.techniques.testOutputAggregation && isTestCommand(command)) {
				after = summarizeTestOutput(after);
				techniques.push("test");
			}

			if (command && config.techniques.gitCompaction && isGitCommand(command)) {
				after = compactGitOutput(command, after);
				techniques.push("git");
			}

			if (command && !structuredOutput && config.techniques.linterAggregation && isLinterCommand(command)) {
				after = summarizeLinterOutput(after);
				techniques.push("linter");
			}

			if (command && !structuredOutput && config.techniques.searchResultGrouping && isSearchCommand(command)) {
				const grouped = groupSearchResults(after);
				if (grouped) {
					after = grouped;
					techniques.push("search");
				}
			}

			if (config.techniques.truncation.enabled && after.length > config.techniques.truncation.maxChars) {
				after = truncateChars(after, config.techniques.truncation.maxChars);
				techniques.push("truncate");
			}

			if (after !== before) {
				track(metrics, "bash", techniques, before, after);
				processedCount += 1;
				if (
					config.logSavings &&
					config.showUpdateEvery > 0 &&
					processedCount % config.showUpdateEvery === 0 &&
					ctx.hasUI
				) {
					ctx.ui.notify(metricsSummary(metrics), "info");
				}

				return {
					content: content.map((entry) => (entry.type === "text" ? { ...entry, text: after } : entry)),
				};
			}
		}

		if (isReadToolResult(event)) {
			const content = event.content;
			const item = content.find((entry) => entry.type === "text");
			if (!item || !("text" in item)) return;

			const path =
				typeof (event.input as { path?: unknown } | undefined)?.path === "string"
					? (event.input as { path: string }).path
					: "";
			const before = item.text;
			const filtered = applySourceFiltering(before, path, config);
			let after = filtered.text;
			const techniques = [...filtered.techniques];

			if (config.techniques.truncation.enabled && after.length > config.techniques.truncation.maxChars) {
				after = truncateChars(after, config.techniques.truncation.maxChars);
				techniques.push("truncate");
			}

			if (after !== before) {
				track(metrics, "read", techniques, before, after);
				processedCount += 1;
				return {
					content: content.map((entry) => (entry.type === "text" ? { ...entry, text: after } : entry)),
				};
			}
		}

		if (isGrepToolResult(event) && config.techniques.searchResultGrouping) {
			const content = event.content;
			const item = content.find((entry) => entry.type === "text");
			if (!item || !("text" in item)) return;

			const before = item.text;
			const grouped = groupSearchResults(before);
			if (!grouped || grouped === before) return;

			const after =
				config.techniques.truncation.enabled && grouped.length > config.techniques.truncation.maxChars
					? truncateChars(grouped, config.techniques.truncation.maxChars)
					: grouped;

			track(metrics, "grep", ["search"], before, after);
			processedCount += 1;
			return {
				content: content.map((entry) => (entry.type === "text" ? { ...entry, text: after } : entry)),
			};
		}
	});

	pi.registerCommand("rtk-stats", {
		description: "Show RTK token savings stats",
		handler: async (_args, ctx) => {
			ctx.ui.notify(metricsSummary(metrics), "info");
		},
	});

	pi.registerCommand("rtk-toggle", {
		description: "Toggle RTK token reduction",
		handler: async (_args, ctx) => {
			enabled = !enabled;
			ctx.ui.notify(`RTK ${enabled ? "enabled" : "disabled"}`, enabled ? "info" : "warning");
		},
	});

	pi.registerCommand("rtk-clear", {
		description: "Clear RTK metrics",
		handler: async (_args, ctx) => {
			metrics.length = 0;
			processedCount = 0;
			ctx.ui.notify("RTK metrics cleared", "info");
		},
	});
}
