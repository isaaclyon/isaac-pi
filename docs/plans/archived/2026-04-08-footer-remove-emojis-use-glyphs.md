# Footer emoji removal and glyph pass

## Goal
Replace emoji-heavy footer labels with restrained Unicode glyphs and section-prefix styling.

## Chosen direction
- Icon style: simple Unicode glyphs
- Labels: section prefixes

## Desired behavior
1. Remove emoji markers like `🌳`, `🌿`, `⚠️`, `✅`, `✏️`, `📦`, `❓` from the custom footer.
2. Use simple readable text with minimal glyphs where helpful, such as `↑` and `↓`.
3. Keep the existing three-line layout and muted color hierarchy.
4. Preserve filtering of MCP/Context7 extension statuses.

## Plan
1. Update tests to assert the new label/text format.
2. Refactor footer label generation in `agent/extensions/custom-footer.ts`.
3. Keep warning/error colors only for exceptional states.
4. Run targeted Vitest tests.
5. Archive this plan.

## Verification
- `npx vitest run agent/test/extensions/custom-footer.test.ts`
