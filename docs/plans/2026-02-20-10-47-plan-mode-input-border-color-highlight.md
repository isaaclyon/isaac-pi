---
title: "Plan mode input border color highlight"
status: approved
decision: new_session
approvedAt: 2026-02-20T16:47:02.477Z
sessionId: 2026-02-20T16-41-09-734Z_6b20d697-76bb-4b77-b320-4b5d92ddd8ba
sessionFile: "/Users/isaaclyon/.pi/agent/sessions/--Users-isaaclyon-Developer-personal-pi--/2026-02-20T16-41-09-734Z_6b20d697-76bb-4b77-b320-4b5d92ddd8ba.jsonl"
---

# Plan mode input border color highlight

## Goal
Make plan mode visually obvious by changing the main TUI input box border lines (top and bottom) to a distinct color whenever plan mode is enabled.

## Context
- Current plan-mode logic is in `.pi/extensions/plan-mode/controller.ts` and `.pi/extensions/plan-mode/index.ts`.
- Plan mode currently shows status + checklist widgets, but the editor border color still follows normal thinking-level behavior.
- Per pi extension/TUI docs (`docs/extensions.md`, `docs/tui.md`), the supported way to customize editor visuals is `ctx.ui.setEditorComponent(...)` with a `CustomEditor` subclass.
- `CustomEditor` exposes `borderColor`; however, the interactive runtime may set border color after editor creation, so the custom editor should re-apply the plan border color during render.

## Steps
1. Add a small editor helper module at `.pi/extensions/plan-mode/editor.ts`.
   - Create a `PlanModeEditor` class extending `CustomEditor`.
   - Inject a border-color function (e.g., `warning` color) and enforce it in `render()` before calling `super.render()`.
2. Wire editor install/uninstall in `.pi/extensions/plan-mode/controller.ts`.
   - Add internal helpers: `installPlanModeEditor(ctx)` and `uninstallPlanModeEditor(ctx)`.
   - Track whether this extension installed the custom editor to avoid redundant resets.
3. Apply editor highlighting on plan-mode lifecycle transitions.
   - Enable: install custom editor when `/plan` turns plan mode on.
   - Disable: restore default editor when plan mode is turned off.
   - Execution handoff: restore default editor when execution mode starts.
   - Session restore: re-apply highlight in `loadFromSession(...)` if plan mode resumes active.
4. Keep existing UX unchanged.
   - Preserve current status line and checklist widget behavior.
   - Keep tool/thinking restrictions exactly as-is.
5. Validate behavior.
   - Typecheck/tests: run `npm test`.
   - Manual verification in interactive mode:
     - `/plan` ON → input border color changes immediately.
     - `/plan` OFF → border returns to normal.
     - Approve plan/start execution → border returns to normal.
     - Resume a session with plan mode active → highlighted border is restored.

## Risks
- If another extension also sets a custom editor, there may be editor-component conflicts (last setter wins).
- Forcing a plan-mode border color may override bash-mode border coloring while plan mode is active.
- In non-interactive modes (print/json/rpc), editor visuals are irrelevant/no-op.

## Open Questions
- Which exact color do you want for plan mode (`warning`, `accent`, `error`, or another)?
- Should we also add a small border label (e.g., `PLAN MODE`) or only change line color?
- During plan mode, should bash mode (`!`) keep its own border color, or should plan-mode color always win?
