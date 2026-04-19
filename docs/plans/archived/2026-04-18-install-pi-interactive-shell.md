# Install pi-interactive-shell

## Goal
Add `pi-interactive-shell` back to the active Pi package list so it loads in this repo.

## Decision
- User chose: install from npm.
- Package found on npm: `pi-interactive-shell` version `0.12.0`.

## Plan
1. Update `agent/settings.json` to add `npm:pi-interactive-shell` to the active `packages` list.
2. Verify the package appears in active config and that the package name resolves in repo searches.
3. Archive this plan under `docs/plans/archived/` after completion.

## Verification
- `agent/settings.json` includes `npm:pi-interactive-shell` in `packages`.
- A repo search finds the package in active config.
