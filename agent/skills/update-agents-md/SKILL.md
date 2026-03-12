---
name: update-agents-md
description: "Scan a repo for all AGENTS.md files and update each one to reflect current code state. Dispatches parallel Haiku sub-agents — one per file — that inspect git diffs since the last commit touching that file. Use when asked to refresh, update, or sync AGENTS.md documentation."
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
  -not -path "*/.cache/*"
```

Record the full relative path for each file. If none are found, report that and stop.

### 2 — Confirm before dispatching

Tell the user how many AGENTS.md files were found and list them. If there are more than 10, ask for confirmation before continuing.

### 3 — Dispatch one sub-agent per file

For each file, call `interactive_shell` in **dispatch** mode:

```
interactive_shell({
  command: `pi --provider anthropic --model claude-3-5-haiku-latest -p --no-session "<PROMPT>"`,
  mode: "dispatch",
  cwd: "<repo_root>",
  name: "agents-md-<slug>",
  reason: "Updating AGENTS.md at <path>"
})
```

**Model:** `anthropic/claude-3-5-haiku-latest` by default. If the user specifies a different model, use that instead.

**Slug rule:** derive `<slug>` from the file path — replace `/` and `.` with `-`, truncate to 30 chars.

**Dispatch all sub-agents before waiting for any.** Do not process them sequentially.

### 4 — Sub-agent prompt template

Build this prompt for each file. Replace `{PATH}` with the AGENTS.md path and `{SCOPE}` with its parent directory:

```
You are updating the AGENTS.md file at {PATH} in this repository.

Execute these steps in order:

1. Read the current AGENTS.md:
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

5. Update the AGENTS.md:
   Rewrite it so it accurately reflects the CURRENT state of {SCOPE}.
   - Preserve existing format and tone.
   - Update any outdated descriptions of files, modules, or responsibilities.
   - Add entries for newly introduced files or modules.
   - Remove entries for deleted files or modules.
   - Do not add speculation or content you cannot verify from the code/diff.
   - Keep it concise — AGENTS.md is guidance for AI agents, not full documentation.

6. Write the updated content back to {PATH}.

Report: "Done — updated {PATH}" or "Done — no changes needed for {PATH}".
```

**Shell escaping:** when embedding this prompt in the `pi -p` command, use single quotes for the outer shell and avoid single quotes inside the prompt. Replace any `'` in the prompt with `'"'"'`. Or write the prompt to a temp file and pass `@/tmp/agents-update-prompt.txt` to pi.

**Temp-file approach (recommended for reliability):**
```bash
PROMPT_FILE=$(mktemp /tmp/agents-update-XXXXXX.txt)
cat > "$PROMPT_FILE" << 'PROMPT'
<the prompt above with {PATH} and {SCOPE} substituted>
PROMPT
# Then pass to pi:
pi --provider anthropic --model claude-3-5-haiku-latest -p --no-session "@$PROMPT_FILE"
```

Use bash to write each prompt to a temp file, then reference it in the pi command.

### 5 — Monitor and collect results

After dispatching all sessions, wait for the dispatch notifications. As each completes:
- Record the session ID, file path, and outcome (updated / no changes / error).

If a sub-agent session errors or produces no output, note it as failed.

### 6 — Final report

When all sessions are done, print a summary table:

```
AGENTS.md Update Results
════════════════════════════════
✅  src/api/AGENTS.md        — updated
✅  src/ui/AGENTS.md         — no changes needed
❌  src/db/AGENTS.md         — sub-agent error (see session agents-md-src-db)
────────────────────────────────
3 files processed · 1 updated · 1 unchanged · 1 failed
```

If any sub-agents failed, offer to retry them individually with a more capable model.

## Constraints

- Never modify files outside of AGENTS.md files.
- Each sub-agent only edits its assigned AGENTS.md — it should not touch other files.
- If the repo has no git history at all, each sub-agent should do a fresh structural scan instead.
- Do not invent content. Sub-agents must base updates on what exists in the code and diffs.
