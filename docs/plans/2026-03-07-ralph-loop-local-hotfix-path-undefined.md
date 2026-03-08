Fix local `ralph-loop-pi` crash where `ralph_loop` throws `The "path" argument must be of type string. Received undefined`.

## User context (why this was requested)

- You asked to use `ralph_loop` for a simple task (`echo hi` thrice).
- The tool crashed before running with a Node path-type error.
- You asked me to debug and fix it.
- Via interview, you chose:
  - **Scope:** local hotfix only
  - **Validation:** smoke test only

## Key acceptance criteria

- [ ] Calling `ralph_loop` no longer crashes with `path`/`undefined` error.
- [ ] `ralph_loop` can execute a minimal loop (3 iterations) and return output.
- [ ] Fix is local and minimal (no compatibility shim layering).
- [ ] A concise root-cause summary is provided with exact file/path touched.

## Known gotchas / watchouts / risks

- The extension lives in global npm install path (`.../node_modules/ralph-loop-pi`), not this repo.
- Global package updates/reinstalls can overwrite the hotfix.
- The bug may stem from missing `ctx.cwd` in non-interactive/tool contexts.
- If there are multiple call sites expecting string cwd, all must be guarded consistently.

## Detailed plan with stage gates

### Stage 1 — Reproduce + root-cause isolate [GATE]
- [x] Inspect installed extension source for `discoverAgents(...)` and any `path.*` usage with nullable cwd.
- [x] Confirm exact failing call path and identify smallest safe fallback.
- [x] Document the root cause before changing code.

### Stage 2 — Minimal hotfix implementation [GATE]
- [x] Patch installed `ralph-loop-pi` source to provide a guaranteed string cwd fallback.
- [x] Keep patch minimal and direct (hard cut fix; no legacy shim layers).
- [x] Re-read edited section to verify no accidental changes.

### Stage 3 — Smoke validation [GATE]
- [ ] Run one `ralph_loop` smoke invocation equivalent to “echo hi thrice”.
- [ ] Verify no crash and expected repeated output/iteration behavior.
- [ ] Record any residual caveats (e.g., persistence across package updates).

### Stage 4 — Closeout
- [ ] Summarize what changed, why it failed, and why this fix works.
- [ ] Share exact edited file path and fallback behavior.
