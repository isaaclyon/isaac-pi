# MemPalace auto-bootstrap plan

- **Date:** 2026-04-10
- **Status:** Completed (archived)
- **Owner:** pi coding agent

## Goal

Automatically initialize MemPalace for a repo the first time the extension needs it, so project memory features can self-start without a manual `mempalace init` step.

## Scope

### In scope
- Auto-run `mempalace init <projectRoot> --yes` when the repo-local bootstrap marker is missing
- Apply bootstrap before status/search/sync so all memory features can self-start
- Keep bootstrap quiet unless it fails
- Add tests proving bootstrap happens once and subsequent calls reuse the initialized repo

### Out of scope
- Changing the existing memory command/tool surface
- Adding a new user-visible bootstrap command
- Trying to infer or repair invalid palace data beyond initial init

## Implementation notes

- Use the repo-local `mempalace.yaml` as the bootstrap marker for first-run initialization
- Keep CLI invocation details inside the Python helper layer
- Preserve the existing fail-loudly behavior for bootstrap failures

## Verification

- Add/adjust helper-script tests for first-run bootstrap and repeat-use behavior
- Run the full Vitest suite after the change
