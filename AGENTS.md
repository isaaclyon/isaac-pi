# AGENTS

## Purpose
Project-specific instructions for the isaac-pi package repo.

## Structure
- `.pi/extensions/` — TypeScript extension modules
- `.pi/skills/` — SKILL.md agent skills
- `.pi/prompts/` — reusable prompt templates (.md)

## Tool and skill routing (use X when Y)

Extensions:
- `scip_*` tools (`scip_find_definition`, `scip_find_references`, `scip_list_symbols`, `scip_search_symbols`, `scip_project_tree`, `scip_reindex`) — use for code navigation and structure in TypeScript/JavaScript and Python projects.
- `web_fetch` — use to fetch and read content from known URLs.
- `anthropic_web_search` — use for broader web research when the exact URL is unknown.
- `questionnaire` — use whenever you need to ask the user for input.
- `review` — use for structured code review and risk checks.
- `handoff` — use when preparing a clean transition summary for another agent/session.

Skills:
- `agent-browser` — use for interactive browser tasks (navigation, clicking, forms, screenshots, extraction).
- `frontend-design` — use for frontend UI design and implementation work.
- `github` — use for GitHub operations via `gh` (issues, PRs, checks, runs).
- `uv` — use for Python package/project workflows instead of pip/venv/python direct commands.
- `changelog-generator` — use for generating, updating, or reformatting a CHANGELOG.md from git history.
