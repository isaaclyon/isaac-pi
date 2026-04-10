# MemPalace memory mode alignment

- **Date:** 2026-04-10
- **Status:** Completed
- **Owner:** pi coding agent

## Goal

Align the extension more closely with upstream MemPalace usage by making automatic per-turn recall non-default, while preserving auto-sync and manual memory tools.

## Decisions from clarification

- Default behavior: wake-up only by default
- Add explicit runtime control via `/memory-mode`
- Keep current search-based recall injection available when recall is explicitly enabled by mode

## Scope

### In scope
- Change default runtime behavior so automatic pre-turn recall search is not enabled by default
- Add `/memory-mode` command with explicit modes
- Keep auto-sync enabled
- Keep `/memory-status`, `/memory-search`, `/memory-sync`, `/memory-debug`
- Add tests for default mode and mode switching

### Out of scope
- Persisting memory mode across sessions
- Reworking MemPalace storage or sync behavior
- Large UI changes beyond concise notifications

## Proposed behavior

- `wake-only` (default): no pre-turn recall lookup; manual search still available
- `selective`: allow pre-turn recall lookup using current natural-language heuristics
- `aggressive`: reserved only if current heuristics differ meaningfully; otherwise avoid adding until needed
- `off`: disable automatic injection paths if any wake-up layer exists later

## Verification

- Added tests proving default mode does not auto-search on `before_agent_start`
- Added tests for `/memory-mode` valid and invalid values
- Ran `npx --yes vitest run agent/extensions/mempalace/register.test.ts agent/extensions/mempalace/lifecycle.test.ts`
- Ran `npx --yes vitest run agent/extensions/mempalace/*.test.ts`
- Ran `npx --yes vitest run`
