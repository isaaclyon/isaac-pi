---
name: simplify-code
description: "Simplify recently modified code while preserving exact behavior. Use after implementing or refactoring code to improve clarity, consistency, and maintainability without changing functionality."
---

# Code Simplifier

Refine code for readability and maintainability while keeping behavior exactly the same.

## Purpose

Use this skill to polish recently changed code so it is easier to read, reason about, and extend.

## When to Use

- After writing or modifying production code
- Before opening a PR or finalizing a change
- When a diff works but feels overly complex, inconsistent, or dense

## Non-Negotiable Constraints

1. **Preserve functionality exactly**
   - Do not change outputs, side effects, APIs, or behavior.
   - If a change risks behavior drift, skip it.

2. **Follow project standards**
   - Apply the repo's conventions from AGENTS.md, README docs, lint rules, and existing patterns.
   - Prefer consistency with nearby code over personal style preferences.

3. **Optimize for clarity over brevity**
   - Prefer explicit, readable code over dense one-liners.
   - Avoid clever transformations that make debugging harder.

4. **Keep scope tight**
   - Focus on files/regions touched in the current task unless asked to broaden scope.

## Simplification Heuristics

Apply only when behavior remains unchanged:

- Reduce unnecessary nesting and branching
- Remove redundant abstractions or dead indirection
- Consolidate duplicated logic when it improves readability
- Improve variable/function naming for intent clarity
- Remove obvious comments that restate the code
- Keep useful comments that explain intent, constraints, or trade-offs
- **Avoid nested ternaries**; use `if/else` or `switch` for multi-branch logic

## Guardrails: Avoid Over-Simplification

Do **not** simplify in ways that:

- Collapse distinct responsibilities into one hard-to-read function
- Remove abstractions that provide meaningful structure
- Favor fewer lines at the cost of comprehension
- Introduce subtle control-flow or state-coupling risks

## Workflow

1. Identify recently modified code
2. Spot readability and consistency improvements
3. Apply minimal, behavior-preserving refinements
4. Re-check for parity and convention alignment
5. Summarize only meaningful changes that impact understanding

## Done Criteria

- Behavior is unchanged
- Code is clearer and easier to maintain
- Changes are localized and proportional to the touched scope
- No new complexity or hidden coupling introduced
