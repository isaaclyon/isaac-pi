import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildToolResult, isToolError } from "./results";
import { worktreeCreate } from "./create";
import { worktreeRemove } from "./remove";
import { worktreeList, formatWorktreeList } from "./list";
import { worktreeSync } from "./sync";

export function registerWorktreeTools(pi: ExtensionAPI): void {
	// ── worktree_create ──
	const CreateParams = Type.Object({
		branch: Type.String({ description: "Branch name to create or check out in the worktree" }),
		base: Type.Optional(
			Type.String({ description: "Base ref to branch from (tag, commit, branch). Defaults to the repo's default branch." }),
		),
		configFiles: Type.Optional(
			Type.Array(Type.String(), {
				description: "Extra file paths to copy from the main repo into the worktree (in addition to .env* files)",
			}),
		),
		force: Type.Optional(
			Type.Boolean({ description: "If a worktree already exists for this branch, return its path instead of erroring" }),
		),
	});

	pi.registerTool({
		name: "worktree_create",
		label: "worktree create",
		description:
			"Create a git worktree for a branch. Automatically installs dependencies (npm/pnpm/yarn/bun/uv/pip), copies .env and gitignored config files, and adds .worktrees/ to .gitignore. Returns the worktree path for use in subsequent commands.",
		parameters: CreateParams,
		async execute(_id, params) {
			const result = await worktreeCreate({
				branch: params.branch,
				base: params.base,
				configFiles: params.configFiles,
				force: params.force,
			});

			if (isToolError(result)) return buildToolResult(result);

			const lines: string[] = [
				result.created ? `Created worktree for '${result.branch}'` : `Worktree already exists for '${result.branch}'`,
				`Path: ${result.path}`,
			];
			if (result.packageManager) lines.push(`Deps installed via: ${result.packageManager}`);
			if (result.configFilesCopied.length > 0) lines.push(`Config files copied: ${result.configFilesCopied.join(", ")}`);
			if (result.gitignoreModified) lines.push("Added .worktrees/ to .gitignore");
			lines.push(`\nTo switch into this worktree, ask the user to run: /move-session ${result.path}`);

			return buildToolResult(result, lines.join("\n"));
		},
	});

	// ── worktree_remove ──
	const RemoveParams = Type.Object({
		branch: Type.String({ description: "Branch name identifying the worktree to remove" }),
		deleteBranch: Type.Optional(
			Type.Boolean({ description: "Also delete the local branch after removing the worktree (default: false)" }),
		),
		force: Type.Optional(
			Type.Boolean({ description: "Skip safety checks (uncommitted changes, unpushed commits) and force removal" }),
		),
	});

	pi.registerTool({
		name: "worktree_remove",
		label: "worktree remove",
		description:
			"Remove a git worktree. Checks for uncommitted changes (blocks unless force) and unpushed commits (warns). Optionally deletes the branch too.",
		parameters: RemoveParams,
		async execute(_id, params) {
			const result = await worktreeRemove({
				branch: params.branch,
				deleteBranch: params.deleteBranch,
				force: params.force,
			});

			if (isToolError(result)) return buildToolResult(result);

			const lines: string[] = [`Removed worktree at ${result.path}`];
			if (result.branchDeleted) lines.push(`Deleted branch '${result.branch}'`);
			if (result.warnings.length > 0) {
				lines.push("Warnings:");
				for (const w of result.warnings) lines.push(`  - ${w}`);
			}

			return buildToolResult(result, lines.join("\n"));
		},
	});

	// ── worktree_list ──
	const ListParams = Type.Object({});

	pi.registerTool({
		name: "worktree_list",
		label: "worktree list",
		description:
			"List all git worktrees with their branch, path, dirty/clean status, and unpushed commit count.",
		parameters: ListParams,
		async execute(_id, _params) {
			const result = await worktreeList();

			if (isToolError(result)) return buildToolResult(result);

			const displayText = formatWorktreeList(result);
			return buildToolResult({ ok: true, worktrees: result }, displayText);
		},
	});

	// ── worktree_sync ──
	const SyncParams = Type.Object({
		branch: Type.Optional(
			Type.String({
				description: "Sync a single worktree by branch name. If omitted, syncs all worktrees.",
			}),
		),
	});

	pi.registerTool({
		name: "worktree_sync",
		label: "worktree sync",
		description:
			"Pull the default branch, rebase worktree branches onto it, and re-install dependencies. If rebase conflicts occur, the rebase is aborted and conflicts are reported.",
		parameters: SyncParams,
		async execute(_id, params) {
			const result = await worktreeSync({ branch: params.branch });

			if (isToolError(result)) return buildToolResult(result);

			const lines: string[] = [`Pulled ${result.defaultBranch}`];

			if (result.results.length === 0) {
				lines.push("No worktrees to sync.");
			}

			for (const r of result.results) {
				if (r.ok) {
					lines.push(`✓ ${r.branch}: rebased onto ${result.defaultBranch}${r.depsReinstalled ? ", deps reinstalled" : ""}`);
				} else {
					lines.push(`✗ ${r.branch}: ${r.error}`);
					if (r.conflicts && r.conflicts.length > 0) {
						lines.push(`  Conflicting files: ${r.conflicts.join(", ")}`);
					}
				}
			}

			return buildToolResult(result, lines.join("\n"));
		},
	});
}
