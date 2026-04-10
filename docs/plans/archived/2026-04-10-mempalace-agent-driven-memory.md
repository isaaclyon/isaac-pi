# MemPalace agent-driven memory behavior

- **Date:** 2026-04-10
- **Status:** Completed
- **Owner:** pi coding agent

## Goal

Restore MemPalace’s agent-harness style automatic recall behavior while preserving explicit MemPalace tools for intentional use by Pi.

## Decisions

- Keep explicit tools available:
  - `project_memory_status`
  - `project_memory_search`
  - `project_memory_sync`
- Keep slash commands available for user control
- Restore automatic pre-turn recall by default
- Keep `/memory-mode` so recall policy remains user-adjustable at runtime
- Session-only settings remain session-local

## Scope

### In scope
- Change default memory mode back to automatic recall
- Preserve explicit tool access and command access
- Update tests to match the intended default
- Run targeted and full Vitest verification

### Out of scope
- Persisting settings across sessions
- Reworking sync/storage logic
- Changing helper script semantics

## Verification

- Updated lifecycle tests for default automatic recall
- Added coverage proving `/memory-mode wake-only` disables automatic recall
- Ran `npx --yes vitest run agent/extensions/mempalace/register.test.ts agent/extensions/mempalace/lifecycle.test.ts`
- Ran `npx --yes vitest run agent/extensions/mempalace/*.test.ts`
- Ran `npx --yes vitest run`
