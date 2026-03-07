import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";

export interface CommandConfig {
	description?: string;
	handler: (args: string, ctx: ExtensionCommandContext) => Promise<void> | void;
}

export const GIT_STATUS_PROMPT = `You are helping with git workflow in this repository.

Goal: report what is currently "dirty" (changed) in a simple, explainable bullet list.

Execution rules:
1) Run \`git status --short\`.
2) If there are no changes, reply: \`Working tree is clean.\` and stop.
3) For each changed file, output one bullet in this format:
   - <path> — <terse plain-English description>
4) Group bullets in this order when present:
   - Staged changes
   - Unstaged changes
   - Untracked files
5) Include rename/move information when relevant.

Output requirements:
- Use bullets only (plus optional short section headers).
- Do not stage, commit, or modify files.
- Keep the response concise and practical.`;

export const GIT_COMMIT_PROMPT = `You are helping with git workflow in this repository.

Goal: make one clean commit for the intended current changes.

Rules:
1) Run git status.
2) If there is nothing to commit, say so and stop.
3) Identify which changed files are intended for this commit.
4) If scope is unclear, ask a short clarification before staging.
5) Stage only intended files.
6) Inspect staged diff and create a Conventional Commit message.
   - Format: <type>: <short summary>
   - Allowed types: feat, fix, docs, refactor, test, chore, ci, build, perf, revert
7) Commit.
8) Report the commit hash and summarize what was committed.

Safety:
- Never force-push unless explicitly requested.
- Never include unrelated files without confirmation.`;

export const GIT_CLEAN_PROMPT = `You are helping with git workflow in this repository.

Goal: commit all intended current work in this branch and move it to a clean working state.

Arguments passed to template: $@

Execution rules:
1) Determine flags from arguments:
   - If arguments include \`push\`, set PUSH=true.
   - If arguments include \`pr\`, set PR=true.
2) Review git status and include all tracked/untracked changes intended for this branch.
   - If anything looks risky or unrelated, ask a brief clarification first.
3) Stage all intended changes.
4) Inspect staged diff and create a Conventional Commit message.
   - Format: <type>: <short summary>
   - Allowed types: feat, fix, docs, refactor, test, chore, ci, build, perf, revert
5) Commit.
6) Confirm working tree is clean.

Post-commit actions:
- If PUSH=true, push current branch to origin.
- If PR=true:
  a) Ensure branch is pushed.
  b) Open a PR with \`gh pr create\` (clear title/body based on the commit/diff).
  c) Check CI status with \`gh pr checks\` (or equivalent).
  d) If checks pass, merge the PR (squash merge is preferred unless repo conventions differ).
  e) Report final state (PR URL, CI result, merge result).

Safety:
- Never force-push unless explicitly requested.
- If there is nothing to commit, say so and stop.`;

export const GIT_PRUNE_PROMPT = `Prune merged branches locally and remotely

Clean up merged branches safely.

Execution rules:
1) Detect the default branch (usually \`main\` or \`master\`) and current branch.
2) Fetch/prune remotes first.
3) Identify branches already merged into the default branch.
4) Delete merged local branches, excluding:
   - current branch
   - default branch
   - protected long-lived branches (if present, e.g. develop/release)
5) Identify corresponding remote branches that are already merged.
6) Delete merged remote branches with \`git push origin --delete <branch>\`.

Safety:
- Do not delete unmerged branches.
- If any branch is ambiguous/risky, ask before deleting.
- Show a short summary of deleted local and remote branches at the end.`;

export const GIT_REBASE_PROMPT = `Pull latest main and rebase current branch onto it. In a worktree, this brings main INTO the worktree — it does not switch back to the main working tree.

Goal: fetch the latest default branch (main/master) and rebase the current branch onto it, so the current branch is up to date with upstream.

Rules:
1) Check for uncommitted changes on the current branch.
   - If there are uncommitted changes, ask whether to stash, commit, or discard them before proceeding.
2) Determine the default branch name (usually \`main\` or \`master\`).
3) Fetch the latest from origin:
   - \`git fetch origin <default-branch>\`
4) If currently inside a git worktree (not the main working tree):
   - stay in the worktree and use \`/worktree sync\`.
5) If on default branch already:
   - \`git pull --rebase origin <default-branch>\`
   If on a feature branch (not in a worktree):
   - \`git fetch origin <default-branch>\`
   - \`git rebase origin/<default-branch>\`
6) Confirm clean working tree and report final state with current branch and latest commit.`;

export const GIT_HELP_TEXT = `Usage: /git <subcommand> [arguments]

Available subcommands:
- /git status — show terse dirty file guidance
- /git commit — create one clean commit for intended changes
- /git clean [push] [pr] — stage/commit all intended changes
- /git prune — prune merged local and remote branches
- /git rebase — update branch by rebasing onto default branch
- /git help — show this help text

Legacy command aliases were removed in this release.
Use:
- /git status
- /git commit
- /git clean
- /git prune
- /git rebase`;

const GIT_USAGE_SUFFIX = `\n
Valid command families: status, commit, clean, prune, rebase, help.`;

function isSlashCommand(input: string): boolean {
	return input.startsWith("/");
}

type GitCommandBuilder = (args: string) => string;

function subcommandHandlerFor(subcommand: string): GitCommandBuilder {
	switch (subcommand) {
		case "status":
			return () => GIT_STATUS_PROMPT;
		case "commit":
			return () => GIT_COMMIT_PROMPT;
		case "clean":
			return (args) => `${GIT_CLEAN_PROMPT}\n\nArguments passed: ${args.trim() ? args.trim() : "(none)"}`;
		case "prune":
			return () => GIT_PRUNE_PROMPT;
		case "rebase":
			return () => GIT_REBASE_PROMPT;
		case "help":
			return () => GIT_HELP_TEXT + GIT_USAGE_SUFFIX;
		default:
			return () => `Unknown /git subcommand: ${subcommand}\nUsage: /git status|commit|clean|prune|rebase|help`;
	}
}

function routeCommand(args: string): string {
	const trimmed = args.trim();
	if (!trimmed) {
		return GIT_HELP_TEXT;
	}

	const [rawSubcommand, ...argParts] = trimmed.split(/\s+/);
	if (rawSubcommand.startsWith("/")) {
		return GIT_HELP_TEXT;
	}

	const subcommand = rawSubcommand.toLowerCase();
	const rest = argParts.join(" ").trim();

	if (subcommand === "help") {
		return `${GIT_HELP_TEXT}${GIT_USAGE_SUFFIX}`;
	}

	const handler = subcommandHandlerFor(subcommand);
	return handler(rest);
}

export default function gitExtension(pi: ExtensionAPI): void {
	pi.registerCommand("git", {
		description: "Canonical git workflow commands (/git help, /git status, /git commit, /git clean, /git prune, /git rebase)",
		handler: async (args, _ctx) => {
			const response = routeCommand(args);
			pi.sendUserMessage(response);
		},
	});
}
