# Remove code simplifier hook and replace it with a manual code-simplifier subagent

Hard-cut from hook-driven simplification at `agent_end` to an explicitly-invoked subagent, with no automatic simplification behavior.

## User context

- You asked to "delete our code simplifier hook and turn it into a code simplifier subagent."
- In interview responses, you chose:
  - Hook source: **Agent-end standard hook**
  - Subagent shape: **New subagent definition only**
  - Invocation mode: **Manual only**
- You want a hard cut (no legacy dual path).

## Key acceptance criteria

- [ ] Any code-simplifier behavior wired through `agent_end` standard-hooks is removed.
- [ ] A new dedicated subagent definition is added for code simplification.
- [ ] The new subagent is available by explicit `subagent_type` (manual invocation only).
- [ ] No automatic simplification remains after the change.
- [ ] Changes are documented in this plan as completed checkboxes.

## Known gotchas / watchouts / risks

- If simplifier behavior is configured outside tracked repo files (for example local/untracked `.pi/standard-hooks.json`), repo changes alone will not remove that local hook.
- The existing simplifier guidance currently lives as a skill (`agent/skills/simplify-code/SKILL.md`); converting to subagent requires deciding whether to keep or remove the skill source file.
- Hard-cut behavior means existing workflows expecting automatic end-of-turn simplification will stop immediately.

## Detailed phased plan (stage-gated)

### Stage 1 — Locate and remove hook wiring (hard cut)
- [x] Audit hook entry points used by standard-hooks for `agent_end` simplification.
- [x] Remove simplifier-specific hook wiring/configuration from tracked files.
- [x] Verify no remaining simplifier hook paths are discovered by package/project script directories.
- [x] Stop for your review before adding the subagent.

### Stage 2 — Create code simplifier subagent
- [ ] Add `agent/agents/code-simplifier.md` with focused simplification instructions (behavior-preserving, readability-first, scoped changes).
- [ ] Configure model/thinking/tools to match editing-focused simplification work.
- [ ] Ensure this subagent is manually invoked only (no auto-trigger integration).
- [ ] Stop for your review after file creation.

### Stage 3 — Validate and finalize
- [ ] Confirm via repo search that simplifier hook wiring is gone.
- [ ] Confirm new subagent file is discoverable under `agent/agents/`.
- [ ] Summarize migration behavior change (auto → manual).
- [ ] After your sign-off and any git-flow instructions, move this plan to `docs/plans/archived/`.
