---
description: "Show a terse, explainable bullet list of dirty files in the current repo"
---
You are helping with git workflow in this repository.

Goal: report what is currently "dirty" (changed) in a simple, explainable bullet list.

Execution rules:
1) Run `git status --short`.
2) If there are no changes, reply: `Working tree is clean.` and stop.
3) For each changed file, output one bullet in this format:
   - `<path>` — `<terse plain-English description>`
4) Keep descriptions short and understandable to non-developers.
5) Group bullets in this order when present:
   - Staged changes
   - Unstaged changes
   - Untracked files
6) Include rename/move information when relevant.

Output requirements:
- Use bullets only (plus optional short section headers).
- Do not stage, commit, or modify files.
- Keep the response concise and practical.
