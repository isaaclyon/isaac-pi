# Replace `lsp-pi` with `pi-lens`

## Goal
Switch the global pi setup from `lsp-pi` to `pi-lens`, let `pi-lens` own its default behavior, and remove obvious local references that still point at the old standalone LSP package/tooling.

## Acceptance criteria
- [ ] Global pi package config no longer includes `npm:lsp-pi@1.0.3`.
- [ ] Global pi package config includes `pi-lens`.
- [ ] The package is installed successfully and visible to pi/npm.
- [ ] Local prompt/instruction references that are specifically about the old standalone LSP setup are updated where appropriate.
- [ ] A short migration note records any behavior changes or follow-up risks.

## Notes
- User wants a full cutover, no compatibility alias, and pi-lens defaults unchanged.
- Keep the change minimal: package swap first, then only update local wording that is clearly stale.
- Since `pi-lens` uses `lsp_navigation` rather than the `lsp` tool name from `lsp-pi`, review local prompt text for outdated guidance.
