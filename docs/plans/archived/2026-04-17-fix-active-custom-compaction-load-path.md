# Plan: remove the remaining active custom-compaction load path

## Goal
Ensure proactive auto-compaction routes through LCM, not any still-loaded `pi-custom-compaction` extension.

## Clarification
User reports that when auto-compact fires, the visible behavior still matches the old custom-compaction package.

## Acceptance criteria
1. No active runtime path still loads `pi-custom-compaction`.
2. Proactive trigger path results in LCM-owned compaction behavior.
3. Add or update focused verification that catches the remaining load-path regression.
4. Archive this plan after completion.

## Plan
1. Inspect all active extension/package load paths and locate any remaining `pi-custom-compaction` source. ✅
2. Add a focused failing regression test or reproducible check for the remaining load path. ✅ (used runtime/package verification instead of a repo test because the bug was in the live installed package state, not source code)
3. Remove or disable the smallest active load path that still enables `pi-custom-compaction`. ✅
4. Re-run focused verification. ✅
5. Archive this plan after completion. ✅

## Findings
- `agent/settings.json` no longer listed `npm:pi-custom-compaction`.
- `pi list` confirmed the package was not enabled in settings.
- The package was still installed globally on disk and still contained a `session_before_compact` handler.
- `pi remove npm:pi-custom-compaction` removed the global npm package; Pi then reported there was no matching settings entry, which matched the current config.
- Post-removal verification showed no global `pi-custom-compaction` installation and no matching package files under the global Node install root.
- LCM remains enabled via `../.pi/vendor/pi-lcm`.

## Verification
- `pi list`
- `npm ls -g pi-custom-compaction --depth=0`
- grep under global node_modules for `pi-custom-compaction`
