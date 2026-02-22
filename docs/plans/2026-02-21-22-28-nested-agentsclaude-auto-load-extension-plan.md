---
title: "Nested AGENTS/CLAUDE Auto-Load Extension Plan"
status: approved
decision: keep_context
approvedAt: 2026-02-22T04:28:52.018Z
sessionId: 2026-02-22T04-10-11-748Z_cb6a4228-e081-4cab-81f7-02b9cfbff2fe
sessionFile: "/Users/isaaclyon/.pi/agent/sessions/--Users-isaaclyon-Developer-personal-pi--/2026-02-22T04-10-11-748Z_cb6a4228-e081-4cab-81f7-02b9cfbff2fe.jsonl"
---

# Nested AGENTS/CLAUDE Auto-Load Extension Plan

## 1) Goal
Build a Pi extension that auto-loads **nested instruction files** on first file touch in a monorepo.

**Default behavior:** per directory, use:
1. `AGENTS.md` if present
2. otherwise `CLAUDE.md` as fallback

When the agent first reads/edits/writes a file in a subtree, it should load instruction files on that file’s ancestor path between `cwd` and the file’s directory, then apply those rules to subsequent turns.

## 2) Context
- Pi startup context loading does ancestor walk-up from `cwd`, but does not recursively scan nested subfolders.
- Extension hooks can implement runtime nested loading:
  - `tool_call` to detect first path touch
  - `context` to inject additional instructions before model calls
  - `session_start` for init/rehydration
- `resources_discover` does not add AGENTS/CLAUDE context files directly.
- Package portability constraints in this repo:
  - implement under `.pi/extensions/`
  - wire through root `package.json` pi manifest
  - avoid local-only settings as source of truth.

## 3) Steps
1. **Define config + defaults**
   - Add extension config (e.g. `.pi/nested-context.json`) with:
     - `enabled: true`
     - `fileSelectionMode: "agents-first-fallback-claude"` (default)
     - optional modes:
       - `"agents-only"`
       - `"claude-only"`
       - `"both"` (load both if present)
     - `strictFirstHit: true` (recommended)
     - `maxChars` for injected context.

2. **Implement path extraction + normalization**
   - Watch `tool_call` for `read`, `edit`, `write`.
   - Normalize path (`@` prefix, relative/absolute), resolve from `ctx.cwd`, ignore paths outside `cwd` subtree.

3. **Implement ancestor discovery with fallback logic**
   - For target file directory, walk up to `cwd`.
   - At each directory apply selected mode:
     - default: prefer `AGENTS.md`; if absent, use `CLAUDE.md`
   - Collect in deterministic order (nearest directory first).
   - Skip already-loaded entries unless changed (optional mtime refresh).

4. **Load + cache rules**
   - Maintain state:
     - `loadedPaths: Set<string>`
     - `loadedEntries: { path, kind: "AGENTS.md" | "CLAUDE.md", content, mtime }[]`
   - Optional persistence via `pi.appendEntry(...)` and rehydrate at `session_start`.

5. **First-hit enforcement**
   - On new rules discovered:
     - load + cache
     - optional UI notice
     - if `strictFirstHit=true`, block that triggering tool call once so model retries with updated rules available.

6. **Inject loaded nested rules into LLM context**
   - In `context` event, append one synthetic instructions message with clear delimiters by file path.
   - Include precedence note: nearest directory rule has priority; AGENTS vs CLAUDE preference is handled during selection.
   - Enforce truncation by `maxChars` and nearest-first priority.

7. **Validation matrix**
   - Directory with `AGENTS.md` only → loads AGENTS.
   - Directory with `CLAUDE.md` only → loads CLAUDE (fallback works).
   - Directory with both in default mode → loads AGENTS only.
   - `both` mode → loads both.
   - Cross-package touches load only relevant ancestor chains.
   - Repeated touches don’t duplicate.
   - Outside-`cwd` paths ignored.

8. **Docs + rollout**
   - Document default fallback behavior explicitly.
   - Document mode options, strict first-hit behavior, precedence, and known bash-path limitation.

## 4) Risks
- **Context growth:** many nested files can inflate token usage.
- **Batch tool calls:** without strict mode, first action may execute before new rules affect behavior.
- **Rule conflicts:** multiple nested files can conflict; precedence must stay explicit.
- **Shell blind spot:** paths inside arbitrary `bash` commands are not reliably discoverable.

## 5) Open Questions
1. Keep `strictFirstHit` default true for safety?
2. In default mode, should parent CLAUDE fallback still load if child AGENTS exists (recommended: yes, per-directory selection)?
3. Should file change refresh be automatic (mtime) or manual via `/reload` only?
