# Localize pi-lcm package

## Goal
Sever this install from the upstream/global `npm:pi-lcm` package by vendoring the currently patched package into this repo and pointing Pi settings at the local copy.

## Acceptance criteria
- [x] Copy the active patched `pi-lcm` package into this repo.
- [x] Update Pi settings to load the local package instead of `npm:pi-lcm`.
- [x] Verify the local package path and settings resolve cleanly.
- [x] Leave the working setup in a state where future package updates will not overwrite the LCM fix.

## Notes
- User preference: no git fork; just sever the connection.
- Current patched source lives in the global install under the fnm Node path.
- Vendored package path: `vendor/pi-lcm/`
- Settings now point `agent/settings.json -> packages[] -> "../vendor/pi-lcm"`
- Installed runtime deps locally with `npm install --omit=dev` inside `vendor/pi-lcm`
- Verification:
  - resolved package path = `/Users/isaaclyon/.pi/vendor/pi-lcm`
  - package manifest loads `./index.ts`
  - patched lines present in vendored `index.ts` and `src/compaction/engine.ts`
  - LSP diagnostics clean for `vendor/pi-lcm/src/compaction/engine.ts`; `vendor/pi-lcm/index.ts` only has the same pre-existing unused import hint
