Vendor the `ralph-loop-pi` extension into this repo, keep the working hotfixes, remove the npm package source to prevent duplicate registrations, and smoke-test the local extension.

## User context (why they asked, what they are working on)

- You asked to keep Ralph loop local with the patch instead of relying on globally installed npm files.
- Current hotfixes are applied inside global `node_modules`, which are fragile and overwritten by reinstall/update.
- You selected:
  - Local path: `agent/extensions/ralph-loop`
  - Remove package source: yes (`npm:ralph-loop-pi`)
  - Validation: smoke test

## Key acceptance criteria

- [ ] Local extension exists at `agent/extensions/ralph-loop` with all required files.
- [ ] Local code includes the runtime fixes already applied (execute signature, cwd fallback, abort-signal guard).
- [ ] `agent/settings.json` no longer includes `npm:ralph-loop-pi`.
- [ ] Only one Ralph tool registration path remains (local extension, no duplicate package load).
- [ ] Smoke test: `ralph_loop` runs a 3-iteration `echo hi` loop successfully.

## Known gotchas, watchouts, risks

- Pi extension discovery must include `agent/extensions/` in this setup.
- Removing the package source before copying code could temporarily disable the tool.
- Prior local deletion removed old `agent/extensions/ralph-loop`; this migration reintroduces it as vendored source.
- Global package updates no longer matter once local extension is active.

## Detailed step-by-step instructions with stage gates / phases

### Stage 1 — Snapshot and prepare [GATE]
- [x] Confirm source files in global package path exist and include hotfixes.
- [x] Confirm destination path `agent/extensions/ralph-loop` does not conflict.

### Stage 2 — Vendor extension files [GATE]
- [x] Create `agent/extensions/ralph-loop/`.
- [x] Copy: `ralph-loop.ts`, `agents.ts`, `types.d.ts`, `README.md` into local folder.
- [x] Add `agent/extensions/ralph-loop/index.ts` wrapper exporting the extension default from `ralph-loop.ts`.
- [x] Verify local files contain hotfix lines.

### Stage 3 — Remove npm package source [GATE]
- [x] Edit `agent/settings.json` and remove `npm:ralph-loop-pi`.
- [x] Verify package list no longer references Ralph package.

### Stage 4 — Validate runtime [GATE]
- [x] Reload Pi runtime if needed for extension discovery/settings changes.
- [x] Run smoke test via `ralph_loop` with 3 iterations of `echo hi`.
- [x] Confirm no crashes and successful completion.

### Stage 5 — Closeout
- [x] Summarize exact files added/changed and rationale.
- [x] Note operational behavior: local extension is now source-of-truth; package reinstall will not affect it.
