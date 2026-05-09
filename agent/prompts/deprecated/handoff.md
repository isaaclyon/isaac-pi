---
name: handoff
description: Create a concise context-transfer prompt for starting a new thread and write it to a repo root-level HANDOFF.md file. Use when the user asks for a handoff, context transfer, new-thread prompt, continuation prompt, or explicitly asks to write HANDOFF.md from the current conversation and goal.
---

# Handoff

> Deprecated: replaced by the global extension at `agent/extensions/handoff.ts`. This file is kept outside the top-level `agent/prompts/` directory so Pi no longer exposes it as a prompt-template `/handoff` command.

## Workflow

1. Identify the repository root.
   - Prefer `git rev-parse --show-toplevel`.
   - If not in a Git repo, use the current working directory and say that this assumption was used.

2. Determine the user's next-thread goal.
   - Use the latest explicit user request when it names the next task.
   - If the goal is missing or materially ambiguous, ask one concise clarifying question before writing the file.

3. Build a self-contained transfer prompt from the current conversation and repo state.
   - Summarize only relevant decisions, approaches, findings, blockers, and validation.
   - List relevant files that were discussed, created, modified, deleted, or should be inspected next.
   - State the next task clearly enough that a fresh thread can proceed without old conversation context.
   - Keep the output concise, but preserve details that would prevent repeated discovery work.

4. Write the prompt to `<repo-root>/HANDOFF.md`.
   - Replace the file contents if it already exists.
   - Do not include preamble such as "Here's the prompt".
   - Do not append chat commentary inside `HANDOFF.md`.

5. Verify the result.
   - Re-read `HANDOFF.md`.
   - Confirm it starts directly with the prompt content and includes `## Context` and `## Task`.
   - In the final reply, report the path written and any assumptions. Keep the final reply short.

## Required Output Format

Write `HANDOFF.md` as a prompt the user can send to start a new thread:

```markdown
## Context
We've been working on X. Key decisions:
- Decision 1
- Decision 2

Files involved:
- path/to/file1.ts
- path/to/file2.ts

## Task
[Clear description of what to do next based on the user's goal]
```

## Source Prompt

Follow this instruction when composing the file:

```text
You are a context transfer assistant. Given a conversation history and the user's goal for a new thread, generate a focused prompt that:

1. Summarizes relevant context from the conversation (decisions made, approaches taken, key findings)
2. Lists any relevant files that were discussed or modified
3. Clearly states the next task based on the user's goal
4. Is self-contained - the new thread should be able to proceed without the old conversation

Format your response as a prompt the user can send to start the new thread. Be concise but include all necessary context. Do not include any preamble like "Here's the prompt" - just output the prompt itself.
```
