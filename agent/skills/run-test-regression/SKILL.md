---
name: run-test-regression
description: "Run the test suite, summarize results, and fix failures without introducing regressions. Use when asked to run tests, fix failing tests, check test results, or verify nothing is broken after a change."
---

# Run Test Regression Skill

Run the full (or scoped) test suite, report results clearly, fix failures in source code, and confirm no regressions were introduced.

## Execution protocol

### 1) Detect the test runner

- Inspect `package.json` (scripts, devDependencies) for jest, vitest, mocha, playwright, etc.
- Inspect `pyproject.toml` or `setup.cfg` for pytest, unittest, etc.
- Look for config files (`jest.config.*`, `vitest.config.*`, `pytest.ini`, etc.).
- If unclear, ask which command to use before proceeding.

### 2) Run the suite

- If the user specifies a scope (file, directory, pattern), run only those tests.
- Otherwise run the full suite.
- Capture all output.

### 3) Summarize results

- Report: total tests, passed, failed, skipped.
- If all pass, report that cleanly and stop.

### 4) For each failure, report

- Test name and file path.
- Short plain-English description of what failed.
- The relevant error message or diff.

### 5) Investigate and fix failures one at a time

- Read the failing test and the code under test.
- Identify the root cause.
- Propose a fix in the **source code** (not the test) and apply it.

### 6) After each fix, re-run the full suite

- Confirm the fix worked.
- Confirm no new failures were introduced (regression check).
- If a new failure appears, flag it immediately and address it before continuing.

### 7) Repeat until all tests pass or the user decides to stop.

## Safety constraints (strict — never violate)

- Never delete or skip tests to make them pass.
- Never disable assertions or weaken test expectations.
- Never modify test files unless the test itself is genuinely wrong — and explain why if you do.
- If a fix is uncertain, explain the tradeoff and ask before applying.
