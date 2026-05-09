---
name: continue
description: Resume work from a repo root-level HANDOFF.md plus live Git context. Use when the user asks to resume, continue from a handoff, pick up a previous thread, inspect current context, or explicitly asks to read HANDOFF.md and run git status/diff before acting.
---

# Continue

## Workflow

1. Identify the repository root.
   - Prefer `git rev-parse --show-toplevel`.
   - If not in a Git repo, use the current working directory and clearly state that Git context is unavailable.

2. Read `<repo-root>/HANDOFF.md`.
   - Treat it as the prior thread's intended transfer prompt, not as guaranteed-current truth.
   - If it is missing, continue by inspecting Git state and say the handoff note was not found.
   - If it is present, extract the stated context, files involved, next task, assumptions, and validation history.

3. Inspect live Git context before making claims or edits.
   - Run `git status --short --branch`.
   - Run `git diff --stat`.
   - Run `git diff -- <relevant paths>` for files named in `HANDOFF.md` or shown as modified.
   - If staged changes exist, also run `git diff --cached --stat` and inspect staged diffs as needed.
   - Use `git log -1 --oneline` when a recent commit may explain the current state.

4. Reconcile the note with the repository.
   - Distinguish confirmed-current facts from handoff-derived facts.
   - Call out mismatches, missing files, already-committed work, or untracked files.
   - Do not overwrite, revert, or clean local changes unless the user explicitly asks.

5. Continue the requested work.
   - If the user asks for a status/orientation, answer with the current state and next safest step.
   - If the user asks to implement, proceed from the verified state using the relevant repo instructions.
   - If the next action is ambiguous or risky, ask one concise clarifying question.

## Response Shape

Prefer a short, practical response:

- State what `HANDOFF.md` said the next task was.
- State what Git says is currently changed or clean.
- Name the immediate next step and why it is safe or useful.
- Mention any mismatch between the note and live repo state.

## Guardrails

- Do not trust `HANDOFF.md` over live files.
- Do not ignore dirty worktree changes; they may belong to the user.
- Do not run destructive Git commands.
- Do not create a new `HANDOFF.md`; use the `handoff` skill for that.
- Keep the final answer concise unless the user asks for a detailed audit.
