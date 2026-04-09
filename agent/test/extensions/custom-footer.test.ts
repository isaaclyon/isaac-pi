import { describe, expect, it } from "vitest";

import { buildFooterLines, formatExtensionStatuses } from "../../extensions/custom-footer.js";

describe("custom footer extension statuses", () => {
	it("joins extension statuses in key order, skips blanks, and hides MCP and Context7 statuses", () => {
		const statuses = new Map<string, string>([
			["zeta", "Z status"],
			["notion-mcp", "Notion MCP connected"],
			["context7", "⚡ context7"],
			["github-pr", "PR #123 ✓ merged"],
			["empty", "   "],
			["alpha", "Alpha status"],
		]);

		expect(formatExtensionStatuses(statuses)).toBe("Alpha status  PR #123 ✓ merged  Z status");
	});
});

describe("custom footer layout", () => {
	it("renders git details on a third line while keeping worktree and branch on the second line", () => {
		const theme = {
			fg: (_tone: string, text: string) => text,
		};

		const lines = buildFooterLines({
			theme: theme as never,
			width: 220,
			cwd: "/Users/isaaclyon/.pi/agent",
			contextPercentValue: 42.1,
			contextWindow: 200_000,
			branch: "feature/test",
			worktreeName: "pi",
			gitSummary: {
				dirtyFiles: 2,
				staged: 1,
				unstaged: 1,
				untracked: 0,
				ahead: 0,
				behind: 0,
				hasUpstream: true,
			},
			extensionStatuses: "PR #123 ✓ merged",
			rightSide: "gpt-5.4",
		});

		expect(lines).toHaveLength(3);
		expect(lines[1]).toContain("worktree: pi");
		expect(lines[1]).toContain("branch: feature/test");
		expect(lines[1]).not.toContain("dirty");
		expect(lines[1]).not.toContain("gpt-5.4");
		expect(lines[1]).not.toMatch(/[🌳🌿⚠️✅✏️📦❓]/u);
		expect(lines[2]).toContain("git: dirty 2");
		expect(lines[2]).toContain("staged 1");
		expect(lines[2]).toContain("unstaged 1");
		expect(lines[2]).toContain("PR #123 ✓ merged");
		expect(lines[2]).toContain("gpt-5.4");
		expect(lines[2]).not.toMatch(/[⚠️✅✏️📦❓]/u);
	});

	it("shows the last three path segments in the top line", () => {
		const theme = {
			fg: (_tone: string, text: string) => text,
		};

		const lines = buildFooterLines({
			theme: theme as never,
			width: 220,
			cwd: "/Users/isaaclyon/repo/.worktrees/name",
			contextPercentValue: 42.1,
			contextWindow: 200_000,
			branch: "feature/test",
			worktreeName: "name",
			gitSummary: {
				dirtyFiles: 0,
				staged: 0,
				unstaged: 0,
				untracked: 0,
				ahead: 0,
				behind: 0,
				hasUpstream: true,
			},
			extensionStatuses: "",
			rightSide: "gpt-5.4",
		});

		expect(lines[0]).toContain("repo/.worktrees/name");
	});

	it("uses muted colors for normal footer text and reserves warning colors for problem states", () => {
		const theme = {
			fg: (tone: string, text: string) => `<${tone}>${text}</${tone}>`,
		};

		const lines = buildFooterLines({
			theme: theme as never,
			width: 500,
			cwd: "/Users/isaaclyon/.pi/agent",
			contextPercentValue: 42.1,
			contextWindow: 200_000,
			branch: "feature/test",
			worktreeName: "pi",
			gitSummary: {
				dirtyFiles: 2,
				staged: 1,
				unstaged: 1,
				untracked: 0,
				ahead: 0,
				behind: 0,
				hasUpstream: true,
			},
			extensionStatuses: "PR #123 ✓ merged",
			rightSide: "gpt-5.4",
		});

		expect(lines[0]).toContain("<dim>~/.pi/agent</dim>");
		expect(lines[0]).toContain("<dim>42.1%/200k</dim>");
		expect(lines[1]).toContain("worktree: <dim>pi</dim>");
		expect(lines[1]).toContain("branch: <dim>feature/test</dim>");
		expect(lines[2]).toContain("git: <warning>dirty 2</warning>");
		expect(lines[2]).toContain("<dim>staged 1</dim>");
		expect(lines[2]).toContain("<dim>unstaged 1</dim>");
		expect(lines[2]).toContain("<dim>↑0</dim>");
		expect(lines[2]).toContain("<dim>↓0</dim>");
		expect(lines[2]).toContain("<dim>PR #123 ✓ merged</dim>");
		expect(lines[2]).toContain("<dim>gpt-5.4</dim>");
		expect(lines.join("\n")).not.toContain("<accent>");
		expect(lines.join("\n")).not.toContain("<success>");
	});
});
