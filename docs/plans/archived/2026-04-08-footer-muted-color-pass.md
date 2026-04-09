# Footer muted color pass

## Goal
Tune the custom footer color usage so it feels calmer and more legible, with selective emphasis instead of broad bright styling.

## Chosen direction
- Style: muted minimal

## Desired behavior
1. Keep most footer text dim or neutral.
2. Reserve warning/error colors for exceptional states:
   - dirty git state
   - high context usage
   - ahead/behind only when non-zero
3. De-emphasize worktree and branch compared with the current accent-heavy styling.
4. Preserve the existing three-line layout and status filtering behavior.

## Plan
1. Inspect current footer tone assignments in `agent/extensions/custom-footer.ts`.
2. Add/update targeted tests for the muted color hierarchy.
3. Refactor tone selection in the footer renderer and git status builder.
4. Run targeted Vitest tests.
5. Archive this plan.

## Verification
- Footer layout tests still pass.
- New tests confirm muted/default tones for normal states and warning tones for exceptional states.
