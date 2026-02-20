# AGENTS

## Purpose
Project-specific instructions for the isaac-pi package repo.

## ⚠️ THIS IS A PORTABLE PACKAGE — READ BEFORE DOING ANYTHING

This repo exists to produce a **published npm package** (`isaac-pi`) that gets installed into other repos. It is NOT a personal config folder. It is NOT a place to install things locally or globally.

**The only correct way to add something to this package:**
1. Add it to `dependencies` (and `bundledDependencies` if it needs to ship with the package) in the **root `package.json`**
2. Reference it in the `pi` manifest in the **root `package.json`** under `extensions`, `skills`, or `prompts`
3. Run `npm install` to lock it

**Never do any of the following:**
- `pi install npm:something` — this installs globally to `~/.pi/agent/settings.json`, NOT into the package
- `pi install -l npm:something` — this writes to `.pi/settings.json` which is NOT published as part of the package
- Add anything only to `.pi/settings.json` or `.pi/npm/package.json` — these are local/dev only and are gitignored
- Add extensions, skills, or tools anywhere that isn't wired through the root `package.json` pi manifest

When someone runs `pi install npm:isaac-pi` in another repo, they get exactly what is declared in the root `package.json`. Nothing else.

## Portability (required)
- Build and modify everything with portability as a default requirement.
- Assume this package will be installed and used in many different repos and environments.
- Prefer repo-relative configuration and sensible fallbacks over machine-specific paths.
- Avoid hard-coded local assumptions unless explicitly requested by the user.

## Structure
- `.pi/extensions/` — TypeScript extension modules
- `.pi/skills/` — SKILL.md agent skills
- `.pi/prompts/` — reusable prompt templates (.md)

## Tool and skill routing (use X when Y)

Extensions:
- `lsp` tool — use for code navigation and live diagnostics in TypeScript/JavaScript and other supported projects. Actions: `definition`, `references`, `hover`, `symbols`, `diagnostics`, `workspace-diagnostics`, `signature`, `rename`, `codeAction`. Prefer over ad-hoc text search or manual file scanning.
- `web_fetch` — use to fetch and read content from known URLs.
- `questionnaire` — use whenever you need to ask the user for input.
- `review` — use for structured code review and risk checks.
- `handoff` — use when preparing a clean transition summary for another agent/session.
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
