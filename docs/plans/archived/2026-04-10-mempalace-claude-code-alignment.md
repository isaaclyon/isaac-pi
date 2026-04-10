# MemPalace Claude Code alignment

- **Date:** 2026-04-10
- **Status:** Completed
- **Owner:** pi coding agent

## Goal

Align the Pi MemPalace extension with the upstream Claude Code integration style: explicit tool use as the primary retrieval path, auto-sync hooks in the background, and no broad hidden recall by default.

## Decisions

- Lean into Pi's integrated tool calling as the primary memory retrieval mechanism
- Keep explicit tools available:
  - `project_memory_status`
  - `project_memory_search`
  - `project_memory_sync`
- Keep slash commands available
- Keep auto-sync hooks enabled
- Disable broad hidden recall by default
- Preserve `/memory-mode selective` as an opt-in aggressive mode
- Session-local settings remain session-only

## Scope

### In scope
- Set default memory mode back to `wake-only`
- Preserve `before_agent_start` recall only for opt-in `selective` mode
- Update tests to reflect tool-first default behavior
- Run targeted MemPalace tests and full Vitest suite

### Out of scope
- Persisting settings across sessions
- Implementing a dedicated wake-up CLI integration layer
- Changing helper or sync semantics

## Verification

- Lifecycle tests prove default mode does not auto-search on `before_agent_start`
- Lifecycle tests prove `selective` mode still injects recall
- Register tests keep `/memory-mode` behavior covered
- Ran `npx --yes vitest run agent/extensions/mempalace/register.test.ts agent/extensions/mempalace/lifecycle.test.ts`
- Ran `npx --yes vitest run agent/extensions/mempalace/*.test.ts`
- Ran `npx --yes vitest run`
