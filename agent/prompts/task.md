---
description: "Run a discrete task through tmux orchestration with handoff-quality worker instructions"
---
You are helping execute a discrete task in this repository using tmux worker orchestration.

Task request: $@

Goal: Use the tmux skill workflow and produce self-contained instructions so a new worker session can continue immediately.

Execution rules:
1) If `$@` is empty, ask the user for the task and stop.
2) Read and follow `.pi/skills/tmux/SKILL.md` before taking any tmux action.
3) Apply worktree-first safety from the tmux skill. Do not run parallel workers in the same checkout when files may overlap.
4) Convert the request into a handoff-quality worker brief using this exact structure:

   ## Context
   ### What was decided
   - ...

   ### What was done
   - ... (or "(none)")

   ### Constraints
   - ...

   ### Key files and scope
   - path/to/file
   - ... (or "(none)")

   ## Task
   ### Objective
   - ...

   ### Acceptance criteria
   - ...

   ### Explicit boundaries
   - In scope: ...
   - Out of scope: ...

   ### Next concrete step(s)
   1. ...
   2. ...

   ### Expected output format from worker
   - ...

5) Use tmux orchestration steps from the skill (spawn → dispatch → collect → exit) with clear worker window names.
6) Report coordinator status clearly:
   - worker window names
   - branch/worktree per worker
   - current stage
   - next action

Requirements:
- Keep instructions concise but complete.
- Preserve exact file paths, commands, and branch/worktree names.
- Prefer one focused objective per worker.
- Do not invent progress; state unknowns explicitly.
