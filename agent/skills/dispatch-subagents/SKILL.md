---
name: dispatch-subagents
description: "Dispatch parallel pi sub-agents for fan-out work: batch file updates, multi-package tasks, parallel reviews. Use when a task decomposes into independent units that can each be handled by a lightweight sub-agent running concurrently."
---

# Dispatch Sub-agents

Fan out work across multiple parallel pi sub-agents. Each sub-agent runs in its own TUI session with full tool access, executes independently, and reports back.

## When to use

- Updating multiple files independently (e.g., AGENTS.md across packages)
- Running parallel reviews, checks, or migrations across packages
- Any task that decomposes into N independent units of similar work

## Core pattern

### 1 — Decompose the task

Identify the independent work units. Each unit becomes one sub-agent with:
- A **scope** (directory, file, or package it operates on)
- A **prompt** (clear instructions for what to do)
- A **session name** (for tracking)

### 2 — Write prompt files

Always write prompts to temp files. Sub-agent prompts can be long and contain special characters that break shell quoting.

```bash
PROMPT_FILE=$(mktemp /tmp/subagent-XXXXXX.txt)
cat > "$PROMPT_FILE" << 'PROMPT'
You are doing X in directory Y.

Execute these steps in order:
1. Read the current state...
2. Make changes...
3. Report: "Done — <outcome>"
PROMPT
```

### 3 — Dispatch with TUI mode (not pipe mode)

**Critical: always use TUI mode.** Sub-agents need interactive tool access (read files, run commands, edit code). Never use `-p` (pipe mode) — it strips tool-use capabilities and produces empty output.

```
interactive_shell({
  command: `pi --provider anthropic --model claude-haiku-4-5 --no-session "$(cat $PROMPT_FILE)"`,
  mode: "dispatch",
  background: true,
  cwd: "<repo_root>",
  name: "<descriptive-slug>",
  reason: "<one-line description>"
})
```

### 4 — Use background mode for parallelism

**Only one overlay can be open at a time.** To run sub-agents in parallel, every dispatch must use `background: true`. This runs them headlessly — the user can still `/attach <id>` to watch any session live.

**Dispatch all sub-agents before waiting for any.** Do not process them sequentially.

```
// Good — all dispatched in one tool-call block
interactive_shell({ command: ..., background: true, name: "task-pkg-a" })
interactive_shell({ command: ..., background: true, name: "task-pkg-b" })
interactive_shell({ command: ..., background: true, name: "task-pkg-c" })

// Bad — waiting for each before starting the next
```

### 5 — Wait for completion notifications

Dispatch mode sends automatic notifications when each session completes. The notification includes:
- Session ID
- Exit status
- Output line count
- A tail preview of the final output

**Do not poll.** Wait for the notifications to arrive. If you need to inspect a completed session, attach briefly:

```
interactive_shell({ attach: "<session-id>", mode: "dispatch" })
```

### 6 — Verify results

Sub-agent sessions are ephemeral — their output may not persist. Verify results through side effects:

```bash
# Check what files changed
git status --short

# Review specific diffs
GIT_PAGER=cat git diff <file>
```

### 7 — Report and clean up

Print a summary table with outcomes, then dismiss all background sessions:

```
interactive_shell({ dismissBackground: true })
```

## Model selection

- **Default:** `claude-haiku-4-5` — fast, cheap, good for scoped tasks
- **Fallback for failures:** retry with `claude-sonnet-4-5` or similar
- **Never hardcode deprecated model IDs.** Model aliases like `claude-3-5-haiku-latest` may stop working. Use current model names. If unsure, check: `pi --provider anthropic --list-models`
- **Let the user override.** If they specify a model, use it.

## Prompt design for sub-agents

Sub-agents work best with:

1. **Explicit steps** — numbered, in order, with exact commands to run
2. **Scoped context** — tell them exactly which directory/files they own
3. **Clear boundaries** — "only edit X, do not touch Y"
4. **Verification step** — ask them to confirm their changes before reporting
5. **Structured report** — "Report: Done — updated X" or "Done — no changes needed for X"

Avoid:
- Vague instructions ("make it better")
- Unbounded scope ("fix everything in the repo")
- Missing context (assume the sub-agent knows nothing about prior conversation)

## Error handling

| Scenario | Action |
|----------|--------|
| Session exits with non-zero code | Check output via attach; note as failed |
| Session produces no file changes | May be correct (no updates needed) — verify via output |
| Session hangs (no completion after 3+ min) | Attach to inspect; kill if stuck |
| Model returns 404 / deprecated | Switch to a current model and re-dispatch |
| Multiple failures on same task | Retry with a more capable model |

After all sessions complete, offer to retry any failures with a stronger model.

## Constraints

- Each sub-agent should only modify files within its assigned scope.
- Do not dispatch more than ~10 sub-agents simultaneously without user confirmation.
- Always verify results via git status / file inspection — do not trust session output alone.
- Clean up temp prompt files and dismiss background sessions when done.
