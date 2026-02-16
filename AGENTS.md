# AGENTS

## Purpose
This file gives the basic working rules for this folder.

## Tech defaults
- Use **TypeScript** as the default language.
- Keep TypeScript strictness as high as possible:
  - `strict: true`
  - `noImplicitAny: true`
  - `strictNullChecks: true`
  - `strictFunctionTypes: true`
  - `strictPropertyInitialization: true`
  - `noImplicitReturns: true`
  - `noFallthroughCasesInSwitch: true`
  - `exactOptionalPropertyTypes: true`
  - `noUncheckedIndexedAccess: true`
- Prefer small, readable files:
  - Aim for **under 350 lines** of code per file when possible.
  - If a file must be larger, split it into smaller files by responsibility.

## Communication style
- The user is not a developer: use plain, practical, easy-to-follow language.
- Keep explanations short and focused on what is happening and why.

## Implementation process
- Before implementing changes, ask clarifying questions if requirements are unclear.
- Favor safe, incremental updates.
- Prefer explicit types and clear naming.

## Collaboration habits
- Use **Conventional Commits** for all commits (for example: `feat: add search filter`, `fix: handle empty response`, `docs: update AGENTS instructions`).
- Use the `gh` CLI for GitHub actions where possible (for example opening PRs, checking status, creating issues, reading PRs).

## Structure
- `.pi/settings.json` — project-level setting overrides
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

## Working folder
- This file lives at the repository root and applies to the whole project.
