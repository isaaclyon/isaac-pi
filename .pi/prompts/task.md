---
description: "Delegate work to an isolated subprocess task"
---
The user wants to delegate work using the `task` tool.

Their request: $@

Your job:
1. Expand this into a detailed, self-contained prompt for the subprocess.
   - Include all relevant context: file paths, decisions, constraints, what to do.
   - The subprocess has ZERO context from this conversation.
   - Read files and explore the codebase as needed to build a complete brief.
2. Decide execution mode based on the work:
   - `single` — the request is one coherent job (most common for short requests)
   - `parallel` — the request naturally splits into independent pieces that
     don't depend on each other (e.g. "refactor auth AND update the docs")
   - `chain` — the work has sequential steps where a later step needs output
     from an earlier one (e.g. "analyze the code, then refactor based on findings")
   - When in doubt, prefer `single`. Only split into parallel/chain when
     there's a clear benefit — don't over-engineer a simple request.
3. Call the `task` tool with the expanded prompt(s).
4. Report the result.

Do NOT just pass through the user's short request as the subprocess prompt.
You must enrich it with real context from the repo.
