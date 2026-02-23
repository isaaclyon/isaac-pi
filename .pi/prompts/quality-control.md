---
description: "Run linting, formatting, and type-checking for the project. Auto-detects tools, reports issues, and offers auto-fixes."
---
You are helping with code quality checks in this repository.

Goal: Detect and run all relevant linting, formatting, and type-checking tools, then produce a clear summary of results and offer to auto-fix what's fixable.

Execution rules:

1) **Auto-detect tools** by inspecting the repo root and common config locations:
   - Check `package.json` (scripts, devDependencies) for: eslint, prettier, biome, tsc/typescript, oxlint, stylelint, etc.
   - Check `pyproject.toml`, `setup.cfg`, `ruff.toml`, `mypy.ini`, `.flake8` for: ruff, mypy, pyright, flake8, black, isort, etc.
   - Check for config files like `.eslintrc*`, `.prettierrc*`, `biome.json`, `tsconfig.json`, `.stylelintrc*`.
   - List exactly which tools you found and will run before proceeding.

2) **Run each check** using the project's own config (prefer `npm run`/`npx`/`pnpm`/`yarn` scripts when defined, fall back to direct tool invocation). Capture full output from each. Run tools in read-only/check mode first — do NOT write changes yet.
   - Linting: `eslint .`, `ruff check .`, `flake8`, `biome lint .`, etc.
   - Formatting: `prettier --check .`, `ruff format --check .`, `biome format .`, `black --check .`, etc.
   - Type-checking: `tsc --noEmit`, `pyright`, `mypy .`, etc.

3) **Summarize results** in a clear, grouped report:
   - List each tool and whether it passed (✅) or failed (❌).
   - Group issues by category: **Type Errors**, **Lint Violations**, **Format Issues**.
   - Within each category, distinguish errors from warnings.
   - Show file, line, and message for each issue. Keep it scannable — use tables or bullet lists.
   - Use plain language so non-developers can follow the gist.

4) **If everything passes**, report that cleanly (e.g. "All checks passed ✅ — no issues found.") and stop.

5) **If there are failures**, offer to auto-fix what can be auto-fixed:
   - Lint fixes: `eslint --fix`, `ruff check --fix`, `biome lint --write`, etc.
   - Format fixes: `prettier --write`, `ruff format`, `biome format --write`, `black`, etc.
   - Clearly state which issues are auto-fixable and which require manual attention.
   - Ask the user before applying any fixes.

6) **After auto-fixes**, re-run all checks that had failures to confirm they are now clean. Report the updated status. If new issues surface, report those too.

7) **Safety constraints — strictly follow these:**
   - Never modify tool configuration files (e.g. `.eslintrc`, `tsconfig.json`, `biome.json`, `pyproject.toml`) to make checks pass.
   - Never add `// eslint-disable`, `# noqa`, `@ts-ignore`, `type: ignore`, or any suppression comments.
   - Never disable, downgrade, or remove rules.
   - Only apply fixes through the tools' own `--fix` / `--write` mechanisms.
   - If a check fails and cannot be auto-fixed, report it clearly and leave it for the user.
