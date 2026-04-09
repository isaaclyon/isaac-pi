# Footer path depth and label emphasis

## Goal
Refine the custom footer by:
1. Showing one more path segment in the top line (last three segments instead of last two).
2. Giving section labels like `worktree:`, `branch:`, and `git:` subtle emphasis without returning to bright, noisy styling.

## Desired behavior
- Example path: `repo/.worktrees/name`
- Labels remain slightly more prominent than values.
- Values stay muted/dim.
- Warning/error emphasis remains reserved for exceptional states.
- Preserve the existing three-line layout and status filtering.

## Plan
1. Add/update tests for path depth and label emphasis.
2. Refactor the path formatter to show the last three segments.
3. Split footer labels from values so labels can stay unstyled and values remain dim.
4. Run targeted Vitest tests.
5. Archive this plan.

## Verification
- `npx vitest run agent/test/extensions/custom-footer.test.ts`
