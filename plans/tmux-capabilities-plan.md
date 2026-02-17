# Plan: tmux capabilities (skill-first, no subagent runtime)

## Why this plan
We are intentionally simplifying scope:
- Remove `pi-subagent` extension work.
- Focus on direct tmux capabilities the agent can use today.
- Deliver as a **skill** first (lowest complexity, fastest iteration).

## Goal
Give pi a safe, practical tmux workflow for:
- creating managed sessions
- listing/attaching/switching
- creating windows and running commands
- cleaning up stale managed sessions

All without introducing a new runtime adapter or lifecycle hooks.

## Non-goals (for now)
- No `pi-subagent` orchestration/runtime implementation.
- No automatic session-start/session-shutdown hooks.
- No tmux server-wide cleanup (`kill-server` is out of scope).

## Safety constraints
1. Default to managed session names with a clear prefix.
2. Never kill non-managed sessions by default.
3. Never run `tmux kill-server`.
4. If targeting an unscoped session, require explicit user intent.
5. Keep commands portable and shell-friendly.

## Managed naming convention
- Default prefix: `pi-`
- Suggested format: `pi-<task>-<timestamp>`
- Example: `pi-release-notes-20260216-1945`

## Implementation phases

### P1 — Remove subagent scope
- Delete `extensions/pi-subagent/`.
- Remove obsolete subagent/tmux runtime plan docs.

### P2 — Add tmux skill
- Add `.pi/skills/tmux/SKILL.md` with:
  - quick start commands
  - managed session naming rules
  - safe create/list/attach/switch/kill workflow
  - stale cleanup snippet (prefix + TTL gated)
  - troubleshooting tips

### P3 — Update project routing docs
- Add `tmux` to skill-routing docs:
  - `AGENTS.md`
  - `.pi/extensions/conventions.md`

### P4 — Validation
- Verify skill discovery works (`$tmux` command available).
- Verify managed-session cleanup only touches prefix-matching sessions.
- Confirm no references to removed `pi-subagent` implementation remain.

## Operator validation checklist
1. Create a managed session:
   - `tmux new-session -d -s pi-demo-<timestamp> -c "$PWD"`
2. Add a window + run a command:
   - `tmux new-window -t pi-demo-<timestamp> -n work -c "$PWD"`
   - `tmux send-keys -t pi-demo-<timestamp>:work 'echo hello' C-m`
3. List sessions and verify naming:
   - `tmux list-sessions`
4. Run stale cleanup snippet with a test prefix and verify only matching sessions are removed.
5. Confirm non-prefixed personal sessions remain untouched.

## Future optional enhancement (only if needed)
If we later need strict automation, add a tiny tmux utility extension with explicit tools:
- `tmux_list_managed`
- `tmux_create_managed_session`
- `tmux_kill_managed_session`
- `tmux_cleanup_managed_stale`

Keep this optional and separate from skill-first delivery.
