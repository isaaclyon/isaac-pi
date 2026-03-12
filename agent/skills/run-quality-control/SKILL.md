---
name: run-quality-control
description: "Run linting, formatting, and type-checking for the project. Use when asked to run QC, quality checks, lint, format, type-check, or clean up code style."
---

# Run Quality Control Skill

Auto-detect and run all relevant linting, formatting, and type-checking tools. Produce a clear summary, then offer to auto-fix what's fixable.

## Execution protocol

### 1) Auto-detect tools

Inspect the repo root and common config locations:

- `package.json` (scripts, devDependencies) for: eslint, prettier, biome, tsc/typescript, oxlint, stylelint, etc.
- `pyproject.toml`, `setup.cfg`, `ruff.toml`, `mypy.ini`, `.flake8` for: ruff, mypy, pyright, flake8, black, isort, etc.
- Config files: `.eslintrc*`, `.prettierrc*`, `biome.json`, `tsconfig.json`, `.stylelintrc*`.

List exactly which tools were found and will be run before proceeding.

### 2) Run each check in read-only mode first

Prefer `npm run` / `npx` / `pnpm` / `yarn` scripts when defined; fall back to direct tool invocation. Do **not** write changes yet.

- Linting: `eslint .`, `ruff check .`, `flake8`, `biome lint .`, etc.
- Formatting: `prettier --check .`, `ruff format --check .`, `biome format .`, `black --check .`, etc.
- Type-checking: `tsc --noEmit`, `pyright`, `mypy .`, etc.

### 3) Summarize results

Produce a grouped report:

- Each tool: ✅ passed or ❌ failed.
- Issues grouped by category: **Type Errors**, **Lint Violations**, **Format Issues**.
- Within each category, distinguish errors from warnings.
- Show file, line, and message for each issue (use tables or bullet lists — keep it scannable).

If everything passes, report cleanly (e.g. "All checks passed ✅") and stop.

### 4) Offer auto-fixes for fixable issues

- Lint: `eslint --fix`, `ruff check --fix`, `biome lint --write`, etc.
- Format: `prettier --write`, `ruff format`, `biome format --write`, `black`, etc.
- Clearly state which issues are auto-fixable and which require manual attention.
- **Ask the user before applying any fixes.**

### 5) After auto-fixes, re-run checks

Re-run only the tools that had failures. Report updated status. If new issues surface, report those too.

## Safety constraints (strict — never violate)

- Never modify tool config files (`.eslintrc`, `tsconfig.json`, `biome.json`, `pyproject.toml`, etc.) to make checks pass.
- Never add suppression comments: `// eslint-disable`, `# noqa`, `@ts-ignore`, `type: ignore`, or similar.
- Never disable, downgrade, or remove rules.
- Only apply fixes through the tools' own `--fix` / `--write` mechanisms.
- If a check fails and cannot be auto-fixed, report it clearly and leave it for the user.
