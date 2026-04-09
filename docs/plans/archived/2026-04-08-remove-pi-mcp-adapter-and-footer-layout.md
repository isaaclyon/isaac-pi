# Remove pi-mcp-adapter and adjust custom footer layout

## Goal
1. Remove the `pi-mcp-adapter` package from local Pi config.
2. Update `agent/extensions/custom-footer.ts` so the footer renders on three lines:
   - line 1: path + context
   - line 2: worktree + branch
   - line 3: git dirty/status + right-side model info

## Constraints
- Keep existing MCP config files in place unless explicitly asked otherwise.
- Make the smallest safe change.
- Prefer test-first for behavior changes.

## Plan
1. Remove `npm:pi-mcp-adapter@2.1.2` from `agent/settings.json`.
2. Verify there are no other repo references that need cleanup.
3. Add or update tests for footer rendering/layout behavior.
4. Refactor `agent/extensions/custom-footer.ts` to render three lines.
5. Run targeted tests and review diff.

## Verification
- Search repo for `pi-mcp-adapter`.
- Run targeted Vitest coverage for footer behavior.
