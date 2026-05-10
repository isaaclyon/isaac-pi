# Plan Mode Extension

## Assumptions
- Install as a global Pi extension at `agent/extensions/plan-mode/index.ts` so `/reload` discovers it.
- `Cmd+P` maps to Pi TUI's `super+p`; `Ctrl+P` maps to `ctrl+p`. These shortcuts intentionally override the default model-cycle key while the extension is loaded.
- Plan mode read-only access means built-in read-only tools plus bash guarded by a conservative allowlist.

## Success criteria
1. Toggle plan mode with `/plan`, `super+p`, and `ctrl+p`.
2. While plan mode is active, the input editor top/bottom border renders green and Pi active tools are restricted to read-only tools.
3. While plan mode is active, the system prompt strongly instructs codebase exploration only and plan production only.
4. After an assistant proposes a plan, show a preview widget and offer:
   - Accept and continue in the same session.
   - Accept and start a new session with the plan plus `Proceed with plan step 1.`
   - Reject and submit feedback for revision.
5. Verify extension TypeScript parses and imports resolve.

## Implementation steps
1. Create `agent/extensions/plan-mode/index.ts` with toggle state, shortcut/command registration, active-tool management, green custom editor, bash guard, and prompt injection.
2. Add plan extraction/preview/choice flow in `agent_end`, plus an internal command for the new-session handoff.
3. Run a TypeScript/import sanity check.
