---
description: "Launch a headless pi subagent in tmux to work on a task in the background"
---
You are launching a background subagent — a separate headless pi instance that runs in a tmux session.

Arguments passed to this template: $@

Execution rules:

1) **Parse the task** from the arguments.
   - If no arguments were provided, ask the user what the subagent should work on.
   - If the arguments are vague, ask a short clarification before proceeding.

2) **Craft a detailed prompt** for the subagent.
   - Expand the user's short request into a clear, self-contained instruction.
   - Include relevant context: current branch, repo path, key files, recent changes — whatever helps the subagent succeed without needing to ask questions.
   - The subagent runs non-interactively (`-p` flag) so the prompt must be complete enough to execute without user input.
   - Wrap the final prompt in a variable (do not display the full prompt to the user unless asked).

3) **Launch the subagent** using tmux tools.
   - Create a managed tmux session: `pi-subagent-<short-slug>-<timestamp>`
     (derive `<short-slug>` from the task, e.g. `review`, `refactor`, `test`).
   - Use `tmux_ensure_session` to create the session.
   - Use `tmux_run` with `waitForExit: true` to execute the pi command and block until it completes:
     ```
     pi -p "<crafted prompt>"
     ```
   - If the prompt is long, write it to a temporary file and use `pi -p @/tmp/pi-subagent-<slug>.md` instead.
   - Set a generous timeout (e.g. `timeoutSec: 300`) since subagents may take a while.

4) **Report back** to the user with:
   - Whether the subagent completed successfully or timed out.
   - A summary of what it did (use `tmux_capture` to read its final output).
   - Any artifacts it produced (files written, results, etc.).

Safety:
- Always use the managed `pi-` prefix for session names.
- Do not pass secrets or API keys in the prompt — the subagent inherits the environment.
- The subagent runs in the current working directory by default.
- If the task could make destructive changes (force push, delete files, etc.), warn the user and ask for confirmation before launching.
