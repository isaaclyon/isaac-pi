import fs from "node:fs/promises";
import type { Stats } from "node:fs";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";

type GitSummary = {
	dirtyFiles: number;
	staged: number;
	unstaged: number;
	untracked: number;
	ahead: number;
	behind: number;
	hasUpstream: boolean;
};

type GitPaths = {
	gitArgsPrefix: string[];
};

type GitRefreshState = {
	cwd: string;
	promise: Promise<void>;
};

function getFsErrorCode(error: unknown): string | undefined {
	if (typeof error !== "object" || error === null || !("code" in error)) return undefined;

	const code = (error as { code?: unknown }).code;
	return typeof code === "string" ? code : undefined;
}

async function resolveGitPaths(cwd: string): Promise<GitPaths | null> {
	let currentDir = path.resolve(cwd);

	while (true) {
		const dotGit = path.join(currentDir, ".git");
		let stats: Stats;

		try {
			stats = await fs.stat(dotGit);
		} catch (error) {
			const code = getFsErrorCode(error);
			if (code === "EACCES" || code === "EPERM") return null;
			if (code !== "ENOENT" && code !== "ENOTDIR") throw error;

			const parentDir = path.dirname(currentDir);
			if (parentDir === currentDir) return null;
			currentDir = parentDir;
			continue;
		}

		if (stats.isDirectory()) {
			return {
				gitArgsPrefix: ["--git-dir", dotGit, "--work-tree", currentDir],
			};
		}

		if (stats.isFile()) {
			try {
				const gitFileContent = await fs.readFile(dotGit, "utf8");
				const match = gitFileContent.match(/^gitdir:\s*(.+)$/m);
				if (!match) return null;

				const gitDir = path.resolve(currentDir, match[1]!.trim());
				return {
					gitArgsPrefix: ["--git-dir", gitDir, "--work-tree", currentDir],
				};
			} catch (error) {
				const code = getFsErrorCode(error);
				if (code === "EACCES" || code === "EPERM" || code === "ENOENT") return null;
				throw error;
			}
		}

		return null;
	}
}


function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function isWindowsStylePath(value: string): boolean {
	return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

function normalizePathSeparators(value: string): string {
	return value.replace(/\\/g, "/");
}

function formatLastPathSegments(cwd: string, segmentCount: number): string {
	const shouldNormalizeSeparators = isWindowsStylePath(cwd) || isWindowsStylePath(process.env.HOME || "") || isWindowsStylePath(process.env.USERPROFILE || "");
	let display = shouldNormalizeSeparators ? normalizePathSeparators(cwd) : cwd;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home) {
		const normalizedHome = shouldNormalizeSeparators ? normalizePathSeparators(home) : home;
		if (display === normalizedHome || display.startsWith(`${normalizedHome}/`)) {
			display = `~${display.slice(normalizedHome.length)}`;
		}
	}

	const segments = display.split("/").filter((segment) => segment.length > 0);
	if (segments.length >= segmentCount) {
		return segments.slice(-segmentCount).join("/");
	}
	if (segments.length > 0) {
		return segments.join("/");
	}
	return display || ".";
}

function buildRightSide(model: ExtensionContext["model"], pi: ExtensionAPI, includeProvider: boolean): string {
	const modelId = model?.id || "no-model";
	let right = modelId;

	if (model?.reasoning) {
		const thinking = pi.getThinkingLevel();
		right = thinking === "off" ? `${modelId} • thinking off` : `${modelId} • ${thinking}`;
	}

	if (includeProvider && model?.provider) {
		right = `(${model.provider}) ${right}`;
	}

	return right;
}

function alignLeftRight(left: string, right: string, width: number): string {
	let safeLeft = left;
	let safeRight = right;
	const minPadding = 2;

	let leftWidth = visibleWidth(safeLeft);
	let rightWidth = visibleWidth(safeRight);

	if (leftWidth + minPadding + rightWidth > width) {
		const maxLeft = Math.max(1, width - minPadding - rightWidth);
		safeLeft = truncateToWidth(safeLeft, maxLeft);
		leftWidth = visibleWidth(safeLeft);
	}

	if (leftWidth + minPadding + rightWidth > width) {
		const maxRight = Math.max(1, width - minPadding - leftWidth);
		safeRight = truncateToWidth(safeRight, maxRight);
		rightWidth = visibleWidth(safeRight);
	}

	const paddingSize = width - leftWidth - rightWidth;
	if (paddingSize <= 0) {
		return `${safeLeft}${safeRight}`;
	}
	return `${safeLeft}${" ".repeat(paddingSize)}${safeRight}`;
}

async function getWorktreeName(pi: ExtensionAPI, cwd: string): Promise<string | null> {
	const gitPaths = await resolveGitPaths(cwd);
	if (!gitPaths) return null;

	const { stdout, code } = await pi.exec("git", [...gitPaths.gitArgsPrefix, "rev-parse", "--show-toplevel"]);
	if (code !== 0) return null;

	const repoRoot = stdout.trim();
	if (!repoRoot) return null;

	return path.basename(repoRoot);
}

async function getGitSummary(pi: ExtensionAPI, cwd: string): Promise<GitSummary | null> {
	const gitPaths = await resolveGitPaths(cwd);
	if (!gitPaths) return null;

	const { stdout, code } = await pi.exec("git", [...gitPaths.gitArgsPrefix, "status", "--porcelain=1", "--branch"]);
	if (code !== 0) return null;

	const lines = stdout
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter((line) => line.length > 0);

	let startIndex = 0;
	let header = "";
	if (lines[0]?.startsWith("## ")) {
		header = lines[0].slice(3);
		startIndex = 1;
	}

	const hasUpstream = header.includes("...");
	const ahead = Number(header.match(/ahead (\d+)/)?.[1] ?? "0");
	const behind = Number(header.match(/behind (\d+)/)?.[1] ?? "0");

	let staged = 0;
	let unstaged = 0;
	let untracked = 0;

	for (let i = startIndex; i < lines.length; i++) {
		const line = lines[i]!;
		if (line.startsWith("?? ")) {
			untracked++;
			continue;
		}

		const stagedCode = line[0] ?? " ";
		const unstagedCode = line[1] ?? " ";

		if (stagedCode !== " " && stagedCode !== "?") staged++;
		if (unstagedCode !== " ") unstaged++;
	}

	const dirtyFiles = lines.length - startIndex;

	return {
		dirtyFiles,
		staged,
		unstaged,
		untracked,
		ahead,
		behind,
		hasUpstream,
	};
}

function formatLabelValue(label: string, value: string, theme: ExtensionContext["ui"]["theme"]): string {
	return `${label} ${theme.fg("dim", value)}`;
}

function buildGitStateText(theme: ExtensionContext["ui"]["theme"], summary: GitSummary | null): string {
	if (!summary) {
		return formatLabelValue("git:", "n/a", theme);
	}

	const parts: string[] = [];

	if (summary.dirtyFiles === 0) {
		parts.push(theme.fg("dim", "clean"));
	} else {
		parts.push(theme.fg("warning", `dirty ${summary.dirtyFiles}`));
		if (summary.staged > 0) parts.push(theme.fg("dim", `staged ${summary.staged}`));
		if (summary.unstaged > 0) parts.push(theme.fg("dim", `unstaged ${summary.unstaged}`));
		if (summary.untracked > 0) parts.push(theme.fg("dim", `untracked ${summary.untracked}`));
	}

	if (summary.hasUpstream) {
		parts.push(summary.ahead > 0 ? theme.fg("warning", `↑${summary.ahead}`) : theme.fg("dim", "↑0"));
		parts.push(summary.behind > 0 ? theme.fg("warning", `↓${summary.behind}`) : theme.fg("dim", "↓0"));
	} else {
		parts.push(theme.fg("dim", "↑-"));
		parts.push(theme.fg("dim", "↓-"));
	}

	return `git: ${parts.join(` ${theme.fg("dim", "·")} `)}`;
}

function shouldHideExtensionStatus(key: string): boolean {
	const normalizedKey = key.toLowerCase();
	return (
		normalizedKey.includes("mcp") ||
		normalizedKey === "context7" ||
		normalizedKey === "lsp" ||
		normalizedKey === "lcm" ||
		normalizedKey === "lcm-compaction-trigger"
	);
}

export function formatExtensionStatuses(statuses: ReadonlyMap<string, string>): string {
	return Array.from(statuses.entries())
		.map(([key, value]) => [key, value.trim()] as const)
		.filter(([key, value]) => !shouldHideExtensionStatus(key) && value.length > 0)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([, value]) => value)
		.join("  ");
}

type FooterLineArgs = {
	theme: ExtensionContext["ui"]["theme"];
	width: number;
	cwd: string;
	contextPercentValue: number | null;
	contextWindow: number;
	branch: string | null;
	worktreeName: string | null;
	gitSummary: GitSummary | null;
	extensionStatuses: string;
	rightSide: string;
};

export function buildFooterLines({
	theme,
	width,
	cwd,
	contextPercentValue,
	contextWindow,
	branch,
	worktreeName,
	gitSummary,
	extensionStatuses,
	rightSide,
}: FooterLineArgs): string[] {
	const shortPath = formatLastPathSegments(cwd, 3);
	const branchLabel = formatLabelValue("branch:", branch ?? "no-branch", theme);
	const treeLabel = formatLabelValue("worktree:", worktreeName ?? "none", theme);
	const gitState = buildGitStateText(theme, gitSummary);
	const contextPercent = contextPercentValue === null ? "?" : contextPercentValue.toFixed(1);
	const contextText =
		contextPercentValue === null
			? `?/${formatTokens(contextWindow)}`
			: `${contextPercent}%/${formatTokens(contextWindow)}`;

	let contextStyled = theme.fg("dim", contextText);
	if (contextPercentValue !== null) {
		if (contextPercentValue > 90) {
			contextStyled = theme.fg("error", contextText);
		} else if (contextPercentValue > 70) {
			contextStyled = theme.fg("warning", contextText);
		}
	}

	const topLine = alignLeftRight(theme.fg("dim", shortPath), contextStyled, width);
	const middleLine = truncateToWidth(
		[theme.fg("dim", treeLabel), theme.fg("dim", branchLabel)].join("  "),
		width,
	);
	const bottomLeftParts = [gitState];
	if (extensionStatuses) {
		bottomLeftParts.push(theme.fg("dim", extensionStatuses));
	}
	const bottomLine = alignLeftRight(bottomLeftParts.join("  "), theme.fg("dim", rightSide), width);

	return [truncateToWidth(topLine, width), middleLine, truncateToWidth(bottomLine, width)];
}

function getContextUsageSafely(ctx: ExtensionContext) {
	try {
		return ctx.getContextUsage();
	} catch (error) {
		if (
			error instanceof Error &&
			error.message.includes("This extension instance is stale after session replacement or reload")
		) {
			return null;
		}

		throw error;
	}
}

export default function (pi: ExtensionAPI) {
	let worktreeName: string | null = null;
	let gitSummary: GitSummary | null = null;
	let gitRefreshInFlight: GitRefreshState | null = null;
	let activeSessionId: string | null = null;
	let footerActivationToken = 0;
	let activeCwd = process.cwd();

	async function refreshGitData(): Promise<void> {
		const cwd = activeCwd;
		if (gitRefreshInFlight?.cwd === cwd) return gitRefreshInFlight.promise;

		const promise = (async () => {
			const [nextWorktreeName, nextGitSummary] = await Promise.all([getWorktreeName(pi, cwd), getGitSummary(pi, cwd)]);
			if (activeCwd !== cwd) return;
			worktreeName = nextWorktreeName;
			gitSummary = nextGitSummary;
		})().finally(() => {
			if (gitRefreshInFlight?.promise === promise) {
				gitRefreshInFlight = null;
			}
		});

		gitRefreshInFlight = { cwd, promise };
		return promise;
	}

	async function activateFooter(ctx: ExtensionContext): Promise<void> {
		const sessionId = ctx.sessionManager.getSessionId();
		const activationToken = ++footerActivationToken;
		activeSessionId = sessionId;
		activeCwd = ctx.cwd;
		await refreshGitData();
		if (activationToken !== footerActivationToken || activeSessionId !== sessionId) return;
		installFooter(ctx);
	}

	function installFooter(ctx: ExtensionContext) {
		activeSessionId = ctx.sessionManager.getSessionId();
		activeCwd = ctx.cwd;
		ctx.ui.setFooter((tui, theme, footerData) => {
			let disposed = false;

			const refreshAndRender = () => {
				void refreshGitData().finally(() => {
					if (!disposed) tui.requestRender();
				});
			};

			const unsubscribe = footerData.onBranchChange(refreshAndRender);
			const refreshInterval = setInterval(refreshAndRender, 10000);
			refreshAndRender();

			return {
				dispose() {
					disposed = true;
					clearInterval(refreshInterval);
					unsubscribe();
				},
				invalidate() {},
				render(width: number): string[] {
					const usage = getContextUsageSafely(ctx);

					const model = ctx.model;
					return buildFooterLines({
						theme,
						width,
						cwd: activeCwd,
						contextPercentValue: usage?.percent ?? null,
						contextWindow: usage?.contextWindow ?? model?.contextWindow ?? 0,
						branch: footerData.getGitBranch(),
						worktreeName,
						gitSummary,
						extensionStatuses: formatExtensionStatuses(footerData.getExtensionStatuses()),
						rightSide: buildRightSide(model, pi, footerData.getAvailableProviderCount() > 1),
					});
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		await activateFooter(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		await activateFooter(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		const sessionId = ctx.sessionManager.getSessionId();
		if (activeSessionId !== null && activeSessionId !== sessionId) return;
		footerActivationToken += 1;
		activeSessionId = sessionId;
		activeCwd = ctx.cwd;
		installFooter(ctx);
	});
}
