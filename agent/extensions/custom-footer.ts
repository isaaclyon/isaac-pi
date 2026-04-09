import fs from "node:fs/promises";
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
	workTree: string;
	gitDir: string;
	gitArgsPrefix: string[];
};

async function resolveGitPaths(cwd: string): Promise<GitPaths | null> {
	let currentDir = path.resolve(cwd);

	while (true) {
		const dotGit = path.join(currentDir, ".git");
		try {
			const stats = await fs.stat(dotGit);
			if (stats.isDirectory()) {
				return {
					workTree: currentDir,
					gitDir: dotGit,
					gitArgsPrefix: ["--git-dir", dotGit, "--work-tree", currentDir],
				};
			}

			if (stats.isFile()) {
				const gitFileContent = await fs.readFile(dotGit, "utf8");
				const match = gitFileContent.match(/^gitdir:\s*(.+)$/m);
				if (!match) return null;

				const gitDir = path.resolve(currentDir, match[1]!.trim());
				return {
					workTree: currentDir,
					gitDir,
					gitArgsPrefix: ["--git-dir", gitDir, "--work-tree", currentDir],
				};
			}
		} catch {
			// Keep walking up.
		}

		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return null;
		currentDir = parentDir;
	}
}


function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

function formatLastPathSegments(cwd: string, segmentCount: number): string {
	let display = cwd;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && cwd.startsWith(home)) {
		display = `~${cwd.slice(home.length)}`;
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

function buildRightSide(ctx: ExtensionContext, pi: ExtensionAPI, includeProvider: boolean): string {
	const modelId = ctx.model?.id || "no-model";
	let right = modelId;

	if (ctx.model?.reasoning) {
		const thinking = pi.getThinkingLevel();
		right = thinking === "off" ? `${modelId} • thinking off` : `${modelId} • ${thinking}`;
	}

	if (includeProvider && ctx.model?.provider) {
		right = `(${ctx.model.provider}) ${right}`;
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
	return normalizedKey.includes("mcp") || normalizedKey === "context7";
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

export default function (pi: ExtensionAPI) {
	let worktreeName: string | null = null;
	let gitSummary: GitSummary | null = null;
	let gitRefreshInFlight: Promise<void> | null = null;
	let activeCwd = process.cwd();

	async function refreshGitData(): Promise<void> {
		if (gitRefreshInFlight) return gitRefreshInFlight;

		gitRefreshInFlight = (async () => {
			const [nextWorktreeName, nextGitSummary] = await Promise.all([
				getWorktreeName(pi, activeCwd),
				getGitSummary(pi, activeCwd),
			]);
			worktreeName = nextWorktreeName;
			gitSummary = nextGitSummary;
		})().finally(() => {
			gitRefreshInFlight = null;
		});

		return gitRefreshInFlight;
	}

	function installFooter(ctx: ExtensionContext) {
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
					const usage = ctx.getContextUsage();

					return buildFooterLines({
						theme,
						width,
						cwd: ctx.cwd,
						contextPercentValue: usage?.percent ?? null,
						contextWindow: usage?.contextWindow ?? ctx.model?.contextWindow ?? 0,
						branch: footerData.getGitBranch(),
						worktreeName,
						gitSummary,
						extensionStatuses: formatExtensionStatuses(footerData.getExtensionStatuses()),
						rightSide: buildRightSide(ctx, pi, footerData.getAvailableProviderCount() > 1),
					});
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		activeCwd = ctx.cwd;
		await refreshGitData();
		installFooter(ctx);
	});

	pi.on("session_switch", async (_event, ctx) => {
		activeCwd = ctx.cwd;
		await refreshGitData();
		installFooter(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		activeCwd = ctx.cwd;
		installFooter(ctx);
	});
}
