---
name: review-with-subagents
description: "Route read-only reviewer subagents based on the kind of coding work being done. Use when implementing or reviewing a change and deciding which reviewer combination to spawn."
---

# Review With Subagents

Choose reviewer subagents based on the current task instead of spawning the whole reviewer roster.

## Purpose

Use this skill to pick the smallest useful reviewer combination for a coding task.

Goals:

- catch the most likely problems for the kind of work being done
- avoid redundant reviewer overlap
- keep reviewer fan-out proportional to risk and scope

## Reviewer Routing

- default: `correctness-reviewer` + `complexity-reviewer`
- bug fix / logic change: `correctness-reviewer`
- refactor / cleanup: `complexity-reviewer` + `duplication-reviewer`
- architecture / boundary / API / new abstraction work: `architecture-reviewer` + `correctness-reviewer` + `yagni-reviewer`
- ops / config / migration / rollout work: `ops-reviewer` + `correctness-reviewer`
- UI changes: `visual-tester` + `correctness-reviewer`
- if scope is unclear or the code area is unfamiliar: `scout` first

## Reviewer Count

- trivial or low-risk edits: use 1 reviewer
- normal changes: use 2 reviewers
- high-risk or cross-cutting changes: use up to 3 reviewers

## Rules

- Prefer the smallest useful combo.
- Do not spawn every reviewer by default.
- Avoid redundant reviewers when their concerns overlap.
- Spawn reviewers in parallel when their work is independent.
- After results arrive, reconcile overlaps or conflicts and apply only useful feedback.

## Quick Mapping

Use these heuristics when the task spans more than one category:

- If correctness risk is high, include `correctness-reviewer`.
- If structure or maintainability is the main concern, include `complexity-reviewer`.
- If the change introduces shared helpers, repeated logic, or parallel concepts, include `duplication-reviewer`.
- If the change adds abstractions, options, or extension points, include `yagni-reviewer`.
- If the change affects module boundaries or public shape, include `architecture-reviewer`.
- If runtime safety, deployability, config, or migrations matter, include `ops-reviewer`.
- If the change is user-visible in the browser, include `visual-tester`.

## Workflow

1. Classify the task by primary change type.
2. If the area is unclear, spawn `scout` first.
3. Pick the smallest reviewer combo that matches the task.
4. Spawn independent reviewers in parallel.
5. Synthesize results, resolve conflicts, and keep only actionable feedback.

## Done Criteria

- Reviewer selection matches the actual task shape.
- Reviewer count is proportional to risk.
- No obviously redundant reviewer was spawned.
- Findings were reconciled before acting on them.
