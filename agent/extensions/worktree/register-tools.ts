import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { buildToolResult, isToolError, makeToolError } from "./results";
import { worktreeCreate } from "./create";
import { worktreeRemove } from "./remove";
import { worktreeList, formatWorktreeList } from "./list";
import { worktreeSync } from "./sync";

type WorktreeAction = "create" | "remove" | "list" | "sync";

type WorktreeToolParams = {
	action: WorktreeAction;
	branch?: string;
	base?: string;
	configFiles?: string[];
	force?: boolean;
	deleteBranch?: boolean;
};

const ACTIONS: WorktreeAction[] = ["create", "remove", "list", "sync"];

const WorktreeParams = Type.Object({
	action: Type.Union([
		Type.Literal("create"),
		Type.Literal("remove"),
		Type.Literal("list"),
		Type.Literal("sync"),
	], {
		description: "Action to perform: create | remove | list | sync",
	}),
	branch: Type.Optional(Type.String({ description: "Branch name (required for create/remove, optional for sync)" })),
	base: Type.Optional(Type.String({ description: "Base ref for create (defaults to repo default branch)" })),
	configFiles: Type.Optional(
		Type.Array(Type.String(), {
			description: "Extra file paths to copy on create (in addition to .env* files)",
		}),
	),
	force: Type.Optional(Type.Boolean({ description: "Force behavior (create: allow existing, remove: skip safety checks)" })),
	deleteBranch: Type.Optional(Type.Boolean({ description: "Also delete local branch on remove" })),
});

function usageText(): string {
	return [
		"Usage:",
		"  /worktree list",
		"  /worktree create <branch> [--base <ref>] [--config <path>]... [--force]",
		"  /worktree remove <branch> [--delete-branch] [--force]",
		"  /worktree sync [branch]",
	].join("\n");
}

function getTextContent(result: ReturnType<typeof buildToolResult>): string {
	return result.content.find((part) => part.type === "text")?.text ?? "";
}

function missingBranchError(action: WorktreeAction) {
	return buildToolResult(makeToolError(`Action '${action}' requires 'branch'.`, "INVALID_ARGUMENT"));
}

async function executeWorktreeAction(params: WorktreeToolParams) {
	switch (params.action) {
		case "create": {
			if (!params.branch) return missingBranchError("create");

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
			if (result.packageManager && result.depsInstallAttempted) {
				if (result.depsInstallSuccess) {
					lines.push(`Deps installed via: ${result.packageManager}`);
				} else {
					lines.push(`Dependency install failed via ${result.packageManager}: ${result.depsInstallError ?? "unknown error"}`);
				}
			}
			if (result.configFilesCopied.length > 0) lines.push(`Config files copied: ${result.configFilesCopied.join(", ")}`);
			if (result.gitignoreModified) lines.push("Added .worktrees/ to .gitignore");
			if (result.created) {
				if (result.direnvAllowRan) {
					if (result.direnvAllowSuccess) {
						lines.push("Ran: direnv allow");
					} else {
						lines.push(`direnv allow failed: ${result.direnvAllowError ?? "unknown error"}`);
					}
				} else {
					lines.push("No .envrc file found; direnv allow was not needed during creation.");
				}
			}
			lines.push("");
			lines.push("Initial commands:");
			if (result.direnvAllowRan) {
				lines.push(`- direnv allow ${result.path}`);
			}
			lines.push(`- /move-session ${result.path}`);

			return buildToolResult(result, lines.join("\n"));
		}

		case "remove": {
			if (!params.branch) return missingBranchError("remove");

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
		}

		case "list": {
			const result = await worktreeList();
			if (isToolError(result)) return buildToolResult(result);
			return buildToolResult({ ok: true, worktrees: result }, formatWorktreeList(result));
		}

		case "sync": {
			const result = await worktreeSync({ branch: params.branch });
			if (isToolError(result)) return buildToolResult(result);

			const lines: string[] = [
				result.fetched
					? `Fetched ${result.upstreamRef}`
					: `No origin remote found; using local ${result.upstreamRef}`,
			];
			if (result.results.length === 0) {
				lines.push("No worktrees to sync.");
			}

			for (const r of result.results) {
				if (r.ok) {
					const depsStatus = r.depsReinstalled
						? ", deps reinstalled"
						: r.depsInstallError
							? `, deps reinstall failed (${r.depsInstallError})`
							: "";
					lines.push(`✓ ${r.branch}: rebased onto ${result.upstreamRef}${depsStatus}`);
				} else {
					lines.push(`✗ ${r.branch}: ${r.error}`);
					if (r.conflicts && r.conflicts.length > 0) {
						lines.push(`  Conflicting files: ${r.conflicts.join(", ")}`);
					}
				}
			}

			return buildToolResult(result, lines.join("\n"));
		}
	}
}

function normalizeQuotedToken(token: string): string {
	if (
		(token.startsWith('"') && token.endsWith('"') && token.length >= 2)
		|| (token.startsWith("'") && token.endsWith("'") && token.length >= 2)
	) {
		return token.slice(1, -1);
	}
	return token;
}

function tokenizeArgs(input: string): string[] {
	const matches = input.match(/"(?:\\.|[^"])*"|'(?:\\.|[^'])*'|\S+/g);
	if (!matches) return [];
	return matches.map(normalizeQuotedToken);
}

function parseWorktreeCommandArgs(args: string): { params?: WorktreeToolParams; error?: string } {
	const tokens = tokenizeArgs(args.trim());
	if (tokens.length === 0) {
		return { error: usageText() };
	}

	const action = tokens[0] as WorktreeAction;
	if (!ACTIONS.includes(action)) {
		return { error: `Unknown action '${tokens[0]}'.\n\n${usageText()}` };
	}

	const rest = tokens.slice(1);

	if (action === "list") {
		if (rest.length > 0) return { error: `Action 'list' does not accept arguments.\n\n${usageText()}` };
		return { params: { action } };
	}

	if (action === "sync") {
		if (rest.length === 0) return { params: { action } };
		if (rest[0] === "--branch") {
			const value = rest[1];
			if (!value || value.startsWith("--")) {
				return { error: `Missing value for --branch.\n\n${usageText()}` };
			}
			if (rest.length > 2) return { error: `Unexpected arguments for sync.\n\n${usageText()}` };
			return { params: { action, branch: value } };
		}
		if (rest[0].startsWith("--")) return { error: `Unknown flag '${rest[0]}'.\n\n${usageText()}` };
		if (rest.length > 1) return { error: `Unexpected arguments for sync.\n\n${usageText()}` };
		return { params: { action, branch: rest[0] } };
	}

	let branch: string | undefined;
	let base: string | undefined;
	let force = false;
	let deleteBranch = false;
	const configFiles: string[] = [];

	for (let i = 0; i < rest.length; i += 1) {
		const token = rest[i];

		if (token === "--force") {
			force = true;
			continue;
		}

		if (token === "--base") {
			const value = rest[i + 1];
			if (!value || value.startsWith("--")) {
				return { error: `Missing value for --base.\n\n${usageText()}` };
			}
			base = value;
			i += 1;
			continue;
		}

		if (token === "--config" || token === "--config-file") {
			const value = rest[i + 1];
			if (!value || value.startsWith("--")) {
				return { error: `Missing value for ${token}.\n\n${usageText()}` };
			}
			configFiles.push(value);
			i += 1;
			continue;
		}

		if (token === "--delete-branch" || token === "--deleteBranch") {
			deleteBranch = true;
			continue;
		}

		if (token.startsWith("--")) {
			return { error: `Unknown flag '${token}'.\n\n${usageText()}` };
		}

		if (!branch) {
			branch = token;
			continue;
		}

		return { error: `Unexpected argument '${token}'.\n\n${usageText()}` };
	}

	if (!branch) {
		return { error: `Action '${action}' requires a branch.\n\n${usageText()}` };
	}

	if (action === "create") {
		if (deleteBranch) {
			return { error: `Action 'create' does not support --delete-branch.\n\n${usageText()}` };
		}

		return {
			params: {
				action,
				branch,
				base,
				configFiles: configFiles.length > 0 ? configFiles : undefined,
				force,
			},
		};
	}

	if (base || configFiles.length > 0) {
		return { error: `Action 'remove' does not support --base/--config.\n\n${usageText()}` };
	}

	return {
		params: {
			action,
			branch,
			deleteBranch,
			force,
		},
	};
}

export function registerWorktreeTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "worktree",
		label: "worktree",
		description:
			"Manage git worktrees with a single tool. Actions: create, remove, list, sync. Use action=create/remove/sync with branch as needed.",
		parameters: WorktreeParams,
		async execute(_id, params) {
			return executeWorktreeAction(params as WorktreeToolParams);
		},
	});

	pi.registerCommand("worktree", {
		description: "Manage git worktrees (/worktree create|remove|list|sync)",
		handler: async (args, ctx) => {
			const parsed = parseWorktreeCommandArgs(args);
			if (!parsed.params) {
				ctx.ui.notify(parsed.error ?? usageText(), "error");
				return;
			}

			const result = await executeWorktreeAction(parsed.params);
			const message = getTextContent(result) || "Done.";
			ctx.ui.notify(message, result.isError ? "error" : "info");
		},
	});
}
