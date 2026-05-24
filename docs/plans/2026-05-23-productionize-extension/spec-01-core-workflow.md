# Spec 01: Build productionize workflow helpers

## Goal

Create deterministic, unit-tested helper logic for the productionize workflow. After this spec, the extension has pure functions for parsing git/GitHub state, formatting PR bodies, sanitizing AI outputs, classifying checks, and building repair prompts.

## Must do

- Create `agent/extensions/productionize/core.ts`.
- Export types for workflow steps, check statuses, changed files, and command failures.
- Implement a branch-name sanitizer that accepts Spark text and returns a safe conventional git branch name.
- Implement one-line AI text sanitizers for commit subjects and PR titles, including empty/multiline fallback behavior.
- Implement dirty-status detection for `git status --porcelain` output.
- Implement deterministic changed-file grouping by top-level directory, with stable sorting.
- Implement GitHub check bucket classification for pass, fail, pending, and skipped states.
- Implement a fix prompt builder that includes the failed step, command, exit code, stdout, stderr, and current workflow context.

## Constraints / Must not do

- Do not call `git`, `gh`, Pi APIs, or any model from `core.ts` helper functions.
- Do not add npm dependencies.
- Do not include raw full logs without truncation in fix prompts.
- Do not trust Spark output without cleanup; branch names, commit messages, and PR titles must be bounded and single-purpose.
- Do not generate PR body text with AI; only PR titles are AI-generated in later specs.

## Acceptance Criteria

- The helper functions are small enough to read and test independently.
- PR changed files are grouped by directory and sorted deterministically.
- Check classification treats failing and cancelled checks as failures, successful checks as passing, and queued/in-progress checks as pending.
- Spark branch-name output cannot create spaces, uppercase-only names, shell metacharacters, or protected `main`/`master` branches.
- Empty or malformed Spark commit-message and PR-title outputs fall back to deterministic one-line strings.
- Fix prompts truncate long stdout/stderr while preserving the failed command and exit code.

## Tests

- `node --test agent/extensions/productionize/core.test.ts` passes.
- Tests cover branch-name sanitization, AI subject/title cleanup, dirty status detection, changed-file grouping, check classification, fix prompt content, and log truncation boundaries.

## Todo

- [ ] Create `core.ts` with exported helper types and functions.
- [ ] Create `core.test.ts` with focused helper tests.
- [ ] Run the focused Node test command.
- [ ] Record test evidence in `ExecPlan.md`.
