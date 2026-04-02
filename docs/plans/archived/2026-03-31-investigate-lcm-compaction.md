# Investigate LCM compaction not triggering

## Goal
Figure out why the current LCM integration does not appear to compact conversation history, identify the failing stage, and fix it if the code is in scope here.

## Acceptance criteria
- [x] Locate the active `pi-lcm` implementation used by this install.
- [x] Determine whether compaction is not triggering, not persisting, or not being assembled into context.
- [x] Implement a fix if the issue is in this repo/install.
- [x] Verify with logs, diagnostics, and/or a focused repro.

## Notes
- User reports: "something is broken about our lcm implementation. doesn't seem to compact"
- Need to inspect both config and runtime artifacts (`agent/lcm/*.db`, logs, installed extension code).
- Active package is the global install at `/Users/isaaclyon/.local/share/fnm/node-versions/v22.22.0/installation/lib/node_modules/pi-lcm`.
- The 2026-03-31 20:19 CT compact did fire: session JSONL recorded a `compaction` entry with `fromHook: true`.
- Failure mode: the hook returned `## Conversation History (Lossless Context Management) ... No summaries generated yet.` while the matching DB conversation still had `0` summaries and `0` compacted messages.
- Root cause matched a prior 2026-03-28 regression: `pi-lcm/index.ts` had reverted to `ctx.modelRegistry.getApiKey(...)` even though current Pi expects `getApiKeyAndHeaders(...)`.
- Hardening fix added in `src/compaction/engine.ts`: if all leaf summarization attempts fail (or return blank text), throw and fall back instead of emitting a fake LCM compaction summary with zero persisted summaries.
- Verification:
  - Session file: `agent/sessions/--Users-isaaclyon-.pi--/2026-03-31T02-18-04-328Z_d0ad4e8d-202e-41ee-aa96-edb6ad9b40ad.jsonl`
  - DB conversation `cfdba23f-5109-46cc-90ba-4a50137b7fca` in `agent/lcm/4e753ebe58c068ff.db` showed `messages=80`, `compacted=0`, `summaries=0` after the compact.
  - LSP diagnostics: clean for `src/compaction/engine.ts`; `index.ts` only has a pre-existing unused import hint.
