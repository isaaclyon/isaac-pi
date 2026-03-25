---
name: update-agents-md
description: "Scan a repo for all AGENTS.md files and update each one to reflect current code state. Dispatches parallel sub-agents — one per file — that inspect git diffs since the last commit touching that file. Use when asked to refresh, update, or sync AGENTS.md documentation."
---

# Update AGENTS.md Skill

Refresh every AGENTS.md in the current repo in parallel. Each sub-agent covers one file's scope, diffs the code since the last relevant commit, and rewrites the file to match the current state.

## Execution workflow

### 1 — Discover all AGENTS.md files

```bash
find . -name "AGENTS.md" \
  -not -path "*/node_modules/*" \
  -not -path "*/.git/*" \
  -not -path "*/dist/*" \
  -not -path "*/.next/*" \
  -not -path "*/build/*" \
  -not -path "*/.cache/*" \
  -not -path "*/.worktrees/*"
```

Record the full relative path for each file. If none are found, report that and stop.

### 2 — Resolve symlinks

Many repos use `AGENTS.md → CLAUDE.md` symlinks. For each discovered file:

```bash
if [ -L "$file" ]; then
  real_target=$(readlink "$file")
  # Edit the real file (e.g., CLAUDE.md), not the symlink
fi
```

Track both the symlink path (for reporting) and the real file path (for the sub-agent to edit).

### 3 — Confirm before dispatching

Tell the user how many files were found and list them (showing symlink targets where applicable). If there are more than 10, ask for confirmation before continuing.

### 4 — Write prompt files and dispatch sub-agents

For each file, write the prompt to a temp file and launch via TUI mode.

**Write the prompt file:**
```bash
PROMPT_FILE=$(mktemp /tmp/agents-update-XXXXXX.txt)
cat > "$PROMPT_FILE" << 'PROMPT'
<the sub-agent prompt with {PATH} and {SCOPE} substituted>
PROMPT
```

**Dispatch in background mode for parallel execution:**
```
interactive_shell({
  command: `pi --provider anthropic --model claude-haiku-4-5 --no-session "$(cat $PROMPT_FILE)"`,
  mode: "dispatch",
  background: true,
  cwd: "<repo_root>",
  name: "agents-md-<slug>",
  reason: "Updating <path>"
})
```

**Critical: use TUI mode, not pipe mode.** The sub-agent needs tool access to read files, run git commands, and write edits. Never use `-p` (pipe mode) — it strips interactive tool-use capabilities.

**Model:** `claude-haiku-4-5` by default. If the user specifies a different model, use that instead. Do not hardcode model versions that may be deprecated — check availability if unsure.

**Background mode is required for parallelism.** Only one overlay can be open at a time. Use `background: true` on all dispatches, then wait for completion notifications.

**Slug rule:** derive `<slug>` from the file path — replace `/` and `.` with `-`, truncate to 30 chars.

**Dispatch all sub-agents before waiting for any.** Do not process them sequentially.

### 5 — Sub-agent prompt template

Build this prompt for each file. Replace `{PATH}` with the real file path to edit (CLAUDE.md if symlinked) and `{SCOPE}` with the scope directory:

```
You are updating the file at {PATH} in this repository.

Execute these steps in order:

1. Read the current file:
   Read file at {PATH}.

2. Find the last git commit that touched this file:
   Run: git log -1 --format="%H %s (%ad)" --date=short -- {PATH}
   Save the commit hash. If the output is empty, this is a new file — skip to step 4.

3. Get all changes in the scope directory since that commit:
   Run: git diff <hash> -- {SCOPE}
   Run: git diff --name-status <hash> -- {SCOPE}
   Also run: git log --oneline <hash>..HEAD -- {SCOPE}
   If the diff is very large (>500 lines), focus on file structure changes and new/deleted files.

4. Scan the current file structure in scope:
   Run: find {SCOPE} -type f -not -path "*/.git/*" -not -path "*/node_modules/*" | sort

5. Update the file:
   Rewrite it so it accurately reflects the CURRENT state of {SCOPE}.
   - Preserve existing format and tone.
   - Update any outdated descriptions of files, modules, or responsibilities.
   - Add entries for newly introduced files or modules.
   - Remove entries for deleted files or modules.
   - Do not add speculation or content you cannot verify from the code/diff.
   - Keep it concise — this is guidance for AI agents, not full documentation.

6. Write the updated content back to {PATH}.

Report: "Done — updated {PATH}" or "Done — no changes needed for {PATH}".
```

### 6 — Monitor and collect results

Wait for dispatch completion notifications. As each completes:
- Note the session ID, file path, and outcome from the notification preview.
- If a notification is ambiguous, attach briefly to check: `interactive_shell({ attach: "<id>", mode: "dispatch" })`

After all complete, verify actual changes:
```bash
git status --short -- '*CLAUDE.md' '*AGENTS.md'
```

If a sub-agent session errors or produces no output, note it as failed.

### 7 — Final report

When all sessions are done, print a summary table:

```
AGENTS.md Update Results
════════════════════════════════
✅  src/api/CLAUDE.md        — updated
✅  src/ui/CLAUDE.md         — no changes needed
❌  src/db/CLAUDE.md         — sub-agent error (see session agents-md-src-db)
────────────────────────────────
3 files processed · 1 updated · 1 unchanged · 1 failed
```

If any sub-agents failed, offer to retry them individually with a more capable model.

Clean up background sessions when done:
```
interactive_shell({ dismissBackground: true })
```

## Constraints

- Never modify files outside of AGENTS.md / CLAUDE.md files.
- Each sub-agent only edits its assigned file — it should not touch other files.
- Always edit the real file, not a symlink target.
- If the repo has no git history at all, each sub-agent should do a fresh structural scan instead.
- Do not invent content. Sub-agents must base updates on what exists in the code and diffs.
