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

function formatLastTwoPathSegments(cwd: string): string {
	let display = cwd;
	const home = process.env.HOME || process.env.USERPROFILE;
	if (home && cwd.startsWith(home)) {
		display = `~${cwd.slice(home.length)}`;
	}

	const segments = display.split("/").filter((segment) => segment.length > 0);
	if (segments.length >= 2) {
		return `${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
	}
	if (segments.length === 1) {
		return segments[0]!;
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

function buildGitStateText(theme: ExtensionContext["ui"]["theme"], summary: GitSummary | null): string {
	if (!summary) {
		return theme.fg("dim", "git: n/a");
	}

	const parts: string[] = [];

	if (summary.dirtyFiles === 0) {
		parts.push(theme.fg("success", "✅ clean"));
	} else {
		const dirtyDetails: string[] = [];
		if (summary.unstaged > 0) dirtyDetails.push(`✏️${summary.unstaged}`);
		if (summary.staged > 0) dirtyDetails.push(`📦${summary.staged}`);
		if (summary.untracked > 0) dirtyDetails.push(`❓${summary.untracked}`);

		parts.push(theme.fg("warning", `⚠️ dirty:${summary.dirtyFiles}`));
		if (dirtyDetails.length > 0) {
			parts.push(theme.fg("dim", `(${dirtyDetails.join(" ")})`));
		}
	}

	if (summary.hasUpstream) {
		const aheadText = summary.ahead > 0 ? theme.fg("warning", `↑${summary.ahead}`) : theme.fg("dim", "↑0");
		const behindText =
			summary.behind > 0 ? theme.fg("warning", `↓${summary.behind}`) : theme.fg("dim", "↓0");
		parts.push(`${aheadText}/${behindText}`);
	} else {
		parts.push(theme.fg("dim", "↑- / ↓-"));
	}

	return parts.join(" ");
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
					const shortPath = formatLastTwoPathSegments(ctx.cwd);
					const branch = footerData.getGitBranch();
					const branchLabel = branch ? `🌿 ${branch}` : "🌿 no-branch";
					const treeLabel = worktreeName ? `🌳 ${worktreeName}` : "🌳 none";
					const gitState = buildGitStateText(theme, gitSummary);

					const usage = ctx.getContextUsage();
					const contextPercentValue = usage?.percent ?? null;
					const contextPercent = contextPercentValue === null ? "?" : contextPercentValue.toFixed(1);
					const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
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

					const rightSide = theme.fg(
						"dim",
						buildRightSide(ctx, pi, footerData.getAvailableProviderCount() > 1),
					);
					const topLine = alignLeftRight(theme.fg("accent", shortPath), contextStyled, width);
					const bottomLeft = `${theme.fg("accent", branchLabel)}  ${theme.fg("accent", treeLabel)}  ${gitState}`;
					const bottomLine = alignLeftRight(bottomLeft, rightSide, width);

					return [truncateToWidth(topLine, width), truncateToWidth(bottomLine, width)];
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
