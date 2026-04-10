# MemPalace extension phase 2 plan

- **Date:** 2026-04-10
- **Status:** Completed (archived)
- **Owner:** pi coding agent

## Goal

Extend the existing MemPalace MVP extension with two lightweight automation features:

1. Automatic session sync on shutdown and before compaction
2. Small wake-up recall injection before turns

## Scope

### In scope
- Register `session_shutdown` and `session_before_compact` hooks that reuse the existing manual sync path
- Register `before_agent_start` hook that performs a tiny project-memory recall search and injects a hidden message only when useful
- Add tests covering hook registration and the new behavior

### Out of scope
- Changing the MemPalace helper contract
- Adding new commands or tools
- Building a richer recall UI
- Making automatic sync block shutdown or compaction

## Implementation notes

- Keep the auto-sync path as small as possible by calling the existing `operations.sync()` implementation
- Keep the recall injection compact and hidden from the UI, with a short summary only
- Skip recall injection if the helper is unavailable or the prompt is too small / irrelevant

## Verification

- Run the targeted Vitest cases for the new lifecycle hooks
- Run the full Vitest suite after the implementation lands
