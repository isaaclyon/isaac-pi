# Hide all built-ins and switch to fully user-owned global custom subagents

Configure pi-subagents to hide/reject all built-in agent types, then define global custom agents with fixed model defaults for full behavioral control.

## User context

- You want full control over subagent behavior and defaults.
- You asked to block defaults and replace them with your own agents.
- You selected exact custom agents: `explorer`, `reviewer`, `documenter`.
- You selected fixed model policy: `openai-codex/gpt-5.3-codex` for all custom agents.
- Thinking levels requested:
  - `explorer`: low
  - `reviewer`: medium
  - `documenter`: high
- Strictness: keep hard rejection for hidden built-ins.

## Key acceptance criteria

- [x] All built-in subagent types are hidden via global config.
- [x] Built-in types are hard-rejected if referenced by name.
- [x] Global custom agents exist at `~/.pi/agent/agents/`:
  - [x] `explorer.md`
  - [x] `reviewer.md`
  - [x] `documenter.md`
- [x] All custom agents set model `openai-codex/gpt-5.3-codex`.
- [x] Thinking levels match requested values (low/medium/high respectively).
- [x] Tool scopes match role intent (read-only vs edit-capable where appropriate).

## Known gotchas / watchouts / risks

- Hiding all built-ins means any workflow referencing `Explore`/`Plan`/`general-purpose` by name will fail until updated.
- Custom agent filenames become subagent type names; typos will create “unknown agent” errors.
- Since this is global config, behavior affects all projects on this machine.

## Detailed phased plan (stage-gated)

### Stage 1 — Enforce full built-in block
- [x] Update `~/.pi/agent/settings.json` key `piSubagentsHiddenBuiltinAgents` to include all built-ins:
  - `general-purpose`
  - `Explore`
  - `Plan`
  - `statusline-setup`
  - `claude-code-guide`
- [x] Verify strict rejection path remains active in vendored extension code.

### Stage 2 — Create global custom agents
- [x] Create `~/.pi/agent/agents/explorer.md`
  - model: `openai-codex/gpt-5.3-codex`
  - thinking: `low`
  - tools: read-only exploration set
- [x] Create `~/.pi/agent/agents/reviewer.md`
  - model: `openai-codex/gpt-5.3-codex`
  - thinking: `medium`
  - tools: review-oriented read-only set
- [x] Create `~/.pi/agent/agents/documenter.md`
  - model: `openai-codex/gpt-5.3-codex`
  - thinking: `high`
  - tools: docs-writing capable set (includes edit/write)

### Stage 3 — Validate and handoff
- [x] Confirm config and agent files are in expected locations.
- [x] Provide quick usage examples for new `subagent_type` values.
- [x] Share rollback steps (unhide built-ins and/or remove custom files).
- [ ] After your sign-off, move this plan to `docs/plans/archived/`.
