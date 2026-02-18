# Coding Conventions

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

## Tool and skill routing (use X when Y)

Extensions:
- `lsp` tool — use for code navigation and live diagnostics in TypeScript/JavaScript and other supported projects. Actions: `definition`, `references`, `hover`, `symbols`, `diagnostics`, `workspace-diagnostics`, `signature`, `rename`, `codeAction`. Prefer over ad-hoc text search or manual file scanning.
- `web_fetch` — use to fetch and read content from known URLs.
- `anthropic_web_search` — use for broader web research when the exact URL is unknown.
- `questionnaire` — use whenever you need to ask the user for input.
- `review` — use for structured code review and risk checks.
- `handoff` — use when preparing a clean transition summary for another agent/session.
- `mcporter_*` tools (`mcporter_list`, `mcporter_call`, `mcporter_auth`) — use to interact with MCP servers and their tools.
- `signal_loop_success` — use to break out of a `/loop` when the breakout condition is satisfied.
- `worktree_*` tools (`worktree_create`, `worktree_remove`, `worktree_list`, `worktree_sync`) — use for git worktree lifecycle management (create with deps/config, remove safely, list status, sync with default branch).
- `task` — use to delegate work to isolated pi subprocesses (single, chain, or parallel). Write detailed, self-contained prompts — subprocesses have no conversation context. Don't delegate trivially; use for real multi-step or parallel work.

Skills:
- `agent-browser` — use for interactive browser tasks (navigation, clicking, forms, screenshots, extraction).
- `frontend-design` — use for frontend UI design and implementation work.
- `github` — use for GitHub operations via `gh` (issues, PRs, checks, runs).
- `uv` — use for Python package/project workflows instead of pip/venv/python direct commands.
- `changelog-generator` — use for generating, updating, or reformatting a CHANGELOG.md from git history.

Prompts:
- `/clean` — commit all intended current repo changes and optionally push or open a PR.
- `/commit` — commit intended current changes.
- `/dirty` — show a terse, explainable list of current dirty files.
- `/generate-changelog` — generate, update, or reformat a CHANGELOG.md from git history.
- `/prune` — prune merged branches locally and remotely.
