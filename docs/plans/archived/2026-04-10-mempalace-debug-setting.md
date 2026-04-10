# MemPalace debug setting

- **Date:** 2026-04-10
- **Status:** Completed
- **Owner:** pi coding agent

## Goal

Add a session-local MemPalace debug mode that can be toggled with a slash command and emits subtle grey/info helper text whenever MemPalace does anything.

## Decisions from clarification

- Toggle command: `/memory-debug`
- Scope: all MemPalace actions
  - status
  - search
  - sync
  - auto-bootstrap
  - auto-sync
  - recall injection
- Surface: TUI notifications / info-style helper text
- Persistence: session only

## Scope

### In scope
- Add `/memory-debug` to toggle the mode on and off
- Emit short helper text for MemPalace activity when debug mode is enabled
- Keep the output non-invasive and informational
- Add tests covering the toggle and at least one debug emission path

### Out of scope
- Persisting debug mode across sessions
- Building a dedicated debug panel or log viewer
- Changing MemPalace behavior itself

## Implementation notes

- Keep the toggle state in the extension runtime, not in repo-local memory
- Reuse existing UI notification plumbing so the text appears in the same subtle style as other info messages
- Keep messages short and actionable, e.g. "MemPalace: auto-init repo" or "MemPalace: search 'auth decision'"

## Verification

- Added command coverage for `/memory-debug` toggle and command-side debug notifications in `agent/extensions/mempalace/register.test.ts`
- Added lifecycle coverage for debug notifications during auto-sync and recall injection in `agent/extensions/mempalace/lifecycle.test.ts`
- Ran `npx --yes vitest run agent/extensions/mempalace/register.test.ts agent/extensions/mempalace/lifecycle.test.ts`
- Ran `npx --yes vitest run agent/extensions/mempalace/*.test.ts`
- Ran `npx --yes vitest run`
