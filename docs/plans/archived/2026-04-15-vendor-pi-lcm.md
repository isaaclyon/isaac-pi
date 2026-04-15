# Vendor pi-lcm into ~/.pi

## Context
- `pi-lcm` is currently loaded from the global Pi package list in `agent/settings.json` as `npm:pi-lcm`.
- We hit an auth-compatibility issue while using Cerebras-backed compaction models (`[LCM] Auth succeeded but apiKey is missing`).
- User wants to vendor the package locally under the root `~/.pi` repo rather than inside the Lola repo.

## Goals
1. Vendor the current `pi-lcm` source into this repo.
2. Point Pi at the vendored package instead of the npm-installed package.
3. Add a regression test around auth resolution for compaction models.
4. Patch the extension so auth handling is compatible with Pi's current auth resolver behavior.
5. Keep upstream provenance documented for later resyncs.

## Proposed location
- Vendored package root: `/Users/isaaclyon/.pi/.pi/vendor/pi-lcm`
- Loaded via `agent/settings.json` using a local package path.

## TDD slices
1. Add a focused test that reproduces the current failure mode in compaction auth resolution.
2. Run the narrowest relevant test target and confirm RED.
3. Implement the minimal auth-handling fix.
4. Re-run the narrow test, then the package test suite.
5. Update settings to load the vendored package and verify the package path is wired correctly.

## Notes
- Keep the vendored copy close to upstream with a small Lola/local diff.
- Record upstream package version and source in the vendored package README or a local VENDORED_FROM note.
- After successful validation, archive this plan under `docs/plans/archived/`.
