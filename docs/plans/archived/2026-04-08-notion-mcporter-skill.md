# Plan: Notion MCP via mcporter skill

## Goal
Create a focused Pi skill in `~/.pi/agent/skills` that teaches the agent how to use the Notion MCP through the `mcporter` CLI without dumping huge tool listings into context.

## Inputs gathered
- Scope: Notion via mcporter only
- Location: `~/.pi/agent/skills`
- Observed `mcporter list notion` output: 16 tools on the Notion MCP, with large schema output that is too verbose for routine use.

## Approach
1. Capture the key mcporter/Notion usage patterns from the docs and current `mcporter list notion` output.
2. Create a new skill with a focused name and precise routing description.
3. Document a low-context workflow:
   - authenticate with `mcporter auth notion` if needed
   - avoid `mcporter list notion` except when explicitly needed
   - prefer targeted commands and output redirection/filtering
   - call known Notion tools directly
4. Include concrete examples for common tasks like search and fetch.
5. Validate file paths/content and summarize how to use the skill.

## Deliverables
- `~/.pi/agent/skills/notion-mcporter/SKILL.md`

## Risks
- Tool names or auth details may change upstream.
- Overly broad instructions could encourage giant context dumps; keep guidance opinionated and specific.

## Verification
- Re-read the created skill.
- Ensure examples align with the current `mcporter list notion` output.
