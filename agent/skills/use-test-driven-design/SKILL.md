---
name: use-test-driven-design
description: "Run strict red→green→refactor delivery with explicit acceptance criteria, incremental test-first changes, and anti-pattern checks. Use when implementing or refactoring behavior that must stay regression-safe."
---

# Test-Driven Design Skill

Use this skill when the user wants high-confidence implementation via test-first development, especially for non-trivial features, bug fixes, or refactors.

## Purpose

Drive work through a strict, auditable **red → green → refactor** loop so behavior is designed from tests first, implementation stays minimal, and quality remains regression-safe.

## Core operating rules (strict)

1. **No production code before a failing test** for the target behavior.
2. **One small behavior slice per cycle** (avoid big-bang edits).
3. **Green means proven**: run relevant tests after each change.
4. **Refactor only after green**; behavior must remain unchanged.
5. **No silent quality erosion**: do not weaken tests to pass bad code.

## Orchestration protocol

For each cycle, follow this exact sequence and report evidence.

### 0) Frame the behavior contract

- Restate the requested behavior in plain English.
- Define acceptance criteria as concrete, testable bullets.
- Identify constraints (performance, compatibility, API shape, error handling).
- If requirements are ambiguous, ask focused questions before coding.

### 1) Plan the next smallest test

- Pick one smallest missing behavior.
- State:
  - target test file/path
  - test name
  - expected failure mode/message
  - why this slice is next

### 2) RED

- Add/modify exactly the test needed for that slice.
- Run the narrowest relevant command first (single test/file), then broader scope if needed.
- Confirm and show that the test fails for the expected reason.

If it does not fail, fix the test design before touching implementation.

### 3) GREEN

- Implement the minimal production change to satisfy that failing test.
- Avoid opportunistic refactors in this step.
- Re-run the same test target until green.
- Run surrounding suite to catch immediate regressions.

### 4) REFACTOR

- Improve naming/structure/duplication only after green.
- Keep behavior identical.
- Re-run full relevant suite after refactor.

### 5) Repeat

- Continue one slice at a time until acceptance criteria are covered.

### 6) Closeout

- Run full project checks expected by repo conventions (tests + type/lint if required).
- Summarize:
  - behaviors added/fixed
  - tests added/updated
  - residual risks / open follow-ups

## Required reporting format (each cycle)

Use this concise structure:

- **Cycle goal**: <small behavior>
- **RED evidence**: <command + failing test output summary>
- **GREEN change**: <minimal code change summary>
- **GREEN evidence**: <command + passing result>
- **REFACTOR notes**: <if any>
- **Regression check**: <scope run + result>

## Test-runner selection (polyglot baseline)

Use existing project conventions first:

- JavaScript/TypeScript: `npm/pnpm/yarn` scripts, Vitest/Jest/Mocha configs
- Python: `pytest` (or existing script/config)
- Other stacks: use repository-defined runner and scripts

If runner/command is unclear, ask before proceeding.

## Anti-patterns (do not do these)

1. **Implementation-first**: writing production code before a failing test.
2. **Batching multiple behaviors** into one giant test or one giant commit.
3. **Vague tests** with weak assertions or snapshot-only checks without intent.
4. **Over-mocking internals** instead of testing observable behavior.
5. **Fixing by muting**: `skip`, `todo`, disabled assertions, blanket ignores.
6. **Changing tests to match a bug** without explicit user agreement.
7. **Refactoring during RED/GREEN** (mixing concerns and hiding regressions).
8. **Skipping broader reruns** after passing a narrow target.
9. **Non-deterministic tests** (time/network/randomness) without controls.
10. **Large speculative rewrites** not demanded by a failing test.

## Escalation / exceptions

Only break strict flow if user explicitly requests it (e.g., emergency hotfix). When that happens:

- call out the deviation,
- explain risk,
- propose a path back to test-first safety immediately after.

## Definition of done

Done means:

- acceptance criteria are covered by tests,
- all relevant tests pass,
- no intentional test weakening/suppression was introduced,
- final summary clearly maps behavior ↔ test evidence.
