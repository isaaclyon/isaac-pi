# Disable selected installed and local extensions

## Goal
Disable the requested installed package extensions and local extensions without deleting local source, and disable local subagent agent configs.

## Requested scope
- Remove installed packages:
  - `@aaronmaturen/pi-context7`
  - `pi-subagents`
- Keep installed packages:
  - `pi-caffeinate`
  - `pi-tool-display`
- Disable local extensions by moving them out of auto-discovery into `agent/extensions-disabled/`:
  - `github-lifecycle/`
  - `mempalace/`
  - `questionnaire.ts`
  - `review.ts`
  - `web-fetch.ts`
- Keep local extension enabled:
  - `tab-status.ts`
- Disable local subagent/agent configs by moving them out of active load paths.

## Plan
1. Update `agent/settings.json` to remove the `context7` and `pi-subagents` package entries.
2. Create disabled holding locations outside Pi auto-discovery paths.
3. Move the requested local extensions from `agent/extensions/` to `agent/extensions-disabled/`.
4. Move local agent definitions from `agent/agents/` to `agent/agents-disabled/` so subagent configs no longer load.
5. Verify the resulting active extension/config layout and summarize what changed.

## Notes
- Do not delete disabled local files.
- `tab-status.ts` remains active per updated request.
