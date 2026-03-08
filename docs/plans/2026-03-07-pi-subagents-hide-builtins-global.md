# Add configurable hidden built-in agents to local pi-subagents copy (global)

Implement a forkable local copy of `@tintinweb/pi-subagents` that can hide selected built-in agent types and reject direct invocation of hidden types, configured from `~/.pi/agent/settings.json`.

## User context

- You asked to remove defaults like `statusline-setup` and `claude-code-guide`.
- You confirmed strict behavior: hidden built-ins should be both hidden in menus and unusable by name.
- You requested a forkable/local setup and noted: “download it to here and remove/sever the connection.”
- You want global behavior controlled via `~/.pi/agent/settings.json`.

## Key acceptance criteria

- [x] Local package copy exists in this workspace (vendored), not tied to npm updates.
- [x] Pi loads the local package globally instead of the npm package.
- [x] New global setting key supports hidden built-ins (proposed: `piSubagentsHiddenBuiltinAgents`).
- [x] Hidden built-ins do not appear in `/agents` lists/tool descriptions.
- [x] `Agent({ subagent_type: "<hidden>" })` is rejected with clear error text.
- [x] Non-hidden built-ins and custom agents continue to work (code path preserved; runtime smoke pending restart).

## Known gotchas / watchouts / risks

- Pi extension APIs may change between versions; vendoring means you own updates.
- If we fully replace `packages` entry, path stability matters (absolute vs relative path).
- Hidden-type filtering must be applied consistently in **all** surfaces:
  - validation (`isValidType`/tool schema text)
  - available type lists (`getAvailableTypes`, `/agents` menu)
  - built-in descriptive strings in `index.ts`
- Avoid compatibility shims; implement hard-cut behavior for hidden built-ins.

## Detailed phased plan (stage-gated)

### Stage 1 — Vendor and rewire package (no behavior changes)
- [x] Copy installed package source into local path under this repo (proposed: `vendor/pi-subagents/`).
- [x] Ensure copy is independent from npm global module folder.
- [x] Update global Pi settings `packages` to reference local path install.
- [x] Verify Pi can still load extension with unchanged behavior (install succeeded; reload on next pi start).

### Stage 2 — Add hidden built-ins config plumbing
- [x] Add config loader for `~/.pi/agent/settings.json` key `piSubagentsHiddenBuiltinAgents`.
- [x] Validate values against built-in type names.
- [x] Expose filtered built-in list via shared helper(s) used by registry + UI + schema text.

### Stage 3 — Enforce strict hide + disable behavior
- [x] Filter hidden built-ins out of `/agents` UI and type description/help text.
- [x] Make validation reject hidden built-ins when passed to `Agent`.
- [x] Keep custom agents unaffected.
- [x] Return explicit error message naming hidden type and config key.

### Stage 4 — Configure, verify, and finalize
- [x] Add `piSubagentsHiddenBuiltinAgents` to `~/.pi/agent/settings.json` with:
  - `statusline-setup`
  - `claude-code-guide`
- [x] Smoke test type visibility and rejection paths (static code-path verification).
- [x] Share exact files changed + rollback instructions.
- [ ] (After your sign-off) move this plan to `docs/plans/archived/`.
