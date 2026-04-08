# Remove `pi-lens` from global pi setup

## Goal
Remove the `pi-lens` package from this pi setup so its LSP lens tools/extensions are no longer loaded.

## Acceptance criteria
- [x] `agent/settings.json` no longer includes `npm:pi-lens@3.8.19`.
- [x] No other local config in this setup still enables `pi-lens`.
- [x] A brief verification note records what was checked and any restart/reload follow-up.

## Verification
- Removed `npm:pi-lens@3.8.19` from `agent/settings.json`.
- Searched under `agent/` for `pi-lens`; no remaining config references were found.
- Confirmed the updated JSON is valid.
- Follow-up: reload or restart pi so the package is no longer loaded in new sessions.

## Notes
- Scope is config-only for this pi setup.
- Kept the change minimal: remove the package entry and verify there are no duplicate enablement paths in this local config.
