---
name: simplify-code
description: "Simplify code while preserving exact behavior. By default, focus on recently modified code; if the user provides an argument, focus on that file, area, or request instead. Use after implementing or refactoring code to improve clarity, consistency, and maintainability without changing functionality."
---

# Simplify Code Skill

Refine code for readability and maintainability while keeping behavior exactly the same.

## Purpose

Use this skill to polish code so it is easier to read, reason about, and extend.

If the user invoked the skill with arguments (for example `/skill:simplify-code src/foo.ts` or `/skill:simplify-code the new auth flow`), treat that input as the focus area.
If no argument was provided, default to recently changed code.

## When to Use

- After writing or modifying production code.
- Before opening a PR or finalizing a change.
- When a diff works but feels overly complex, inconsistent, or dense.

## Non-Negotiable Constraints

1. **Preserve functionality exactly**
   - Do not change outputs, side effects, interfaces, or behavior.
   - If a change risks behavior drift, skip it.

2. **Follow project standards**
   - Apply the repo's conventions from AGENTS.md, README docs, lint rules, and existing patterns.
   - Prefer consistency with nearby code over personal style preferences.

3. **Optimize for clarity over brevity**
   - Prefer explicit, readable code over dense one-liners.
   - Avoid clever transformations that make debugging harder.

4. **Keep scope tight**
   - If the user provided a focus area, stay within that scope unless they explicitly broaden it.
   - Otherwise, focus on files or regions touched in the current task.

## Simplification Heuristics

Apply only when behavior remains unchanged:

- Reduce unnecessary nesting and branching.
- Remove redundant abstractions or dead indirection.
- Consolidate duplicated logic when it improves readability.
- Improve variable/function naming for intent clarity.
- Remove obvious comments that restate the code.
- Keep useful comments that explain intent, constraints, or trade-offs.
- Avoid nested ternaries; use `if`/`else` or `switch` for multi-branch logic.

## Guardrails: Avoid Over-Simplification

Do **not** simplify in ways that:

- Collapse distinct responsibilities into one hard-to-read function.
- Remove abstractions that provide meaningful structure.
- Favor fewer lines at the cost of comprehension.
- Introduce subtle control-flow or state-coupling risks.

## Read-Only Reviewer Pass

For non-trivial diffs, or whenever the user asks for simplification review, invoke these read-only subagents before editing:

- `complexity-reviewer`: finds cognitive/structural complexity and unclear control flow.
- `duplication-reviewer`: finds DRY violations, repeated concepts, and drift risks across related code.
- `yagni-reviewer`: finds KISS/YAGNI violations, speculative abstractions, and unnecessary configurability.

Synthesize their findings before making changes. Apply only recommendations that are local, behavior-preserving, and aligned with the current task. Ignore suggestions that broaden scope or add abstraction without clear current value.

## Workflow

1. Determine scope from the user's argument if provided; otherwise identify recently modified code.
2. For non-trivial diffs, run the simplification reviewer pass.
3. Spot readability and consistency improvements within that scope.
4. Apply minimal, behavior-preserving refinements.
5. Re-check for parity and convention alignment.
6. Summarize only meaningful changes that impact understanding.

## Done Criteria

- Behavior is unchanged.
- Code is clearer and easier to maintain.
- Changes are localized and proportional to the touched scope.
- No new complexity or hidden coupling is introduced.
