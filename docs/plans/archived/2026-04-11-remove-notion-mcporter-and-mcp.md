# Remove Notion mcporter skill and Notion MCP wiring

## Goal
Remove the live Notion mcporter skill and current Notion MCP configuration/wiring from the repo while leaving archived historical references intact.

## Acceptance criteria
- [x] `agent/skills/notion-mcporter/` is removed.
- [x] Current Notion MCP config is removed.
- [x] Current live references to the skill/config are removed.
- [x] Archived plans/history remain untouched.
- [x] Verification confirms no current live references remain.

## Notes
- Keep the change minimal and focused on live assets/config.

## Verification
- Removed `agent/skills/notion-mcporter/`.
- Removed `agent/extensions/notion-mcp.json`.
- Cleared the Notion server entry from `agent/mcp.json`.
- Removed the `.gitignore` entry for the deleted MCP credential file.
- Replaced the Notion-specific footer test fixture with a generic MCP fixture.
- Ran `npx --yes vitest run agent/test/extensions/custom-footer.test.ts`.
