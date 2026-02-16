---
name: subagent
description: Delegate work to specialized subagents using single, parallel, chain, orchestrator, and pool modes.
---

# Subagent Orchestration

Use the `subagent` tool when a task is easier, faster, or safer to split into isolated sub-tasks.

Subagents run in separate `pi` processes, so they get fresh context and cannot pollute the parent session.

## When to use

- You want independent tasks in parallel
- You want a staged workflow (analyze → design → implement → review)
- You want stronger isolation for risky or noisy tasks
- You want a long-lived agent for iterative follow-ups

## Agent sources

The tool resolves agents from:
- `~/.pi/agent/agents/*.md` (user)
- `.pi/agents/*.md` (project)

Scope is controlled by `agentScope`:
- `"user"` (default)
- `"project"`
- `"both"`

## Modes

### 1) Single (one-shot)
```json
{ "agent": "explorer", "task": "Map the auth flow end-to-end" }
```

### 2) Parallel (one-shot)
```json
{
  "tasks": [
    { "agent": "explorer", "task": "Trace API entrypoints" },
    { "agent": "explorer", "task": "Trace persistence layer" },
    { "agent": "reviewer", "task": "Check recent auth-related diffs for risks" }
  ]
}
```

### 3) Chain (one-shot pipeline)
Use `{previous}` to pass output forward.
```json
{
  "chain": [
    { "agent": "explorer", "task": "Map current implementation and constraints" },
    { "agent": "architect", "task": "Design a concrete implementation plan from this:\n{previous}" },
    { "agent": "codex-worker", "task": "Implement the plan:\n{previous}" },
    { "agent": "reviewer", "task": "Review what was implemented:\n{previous}" }
  ]
}
```

### 4) Orchestrator (long-lived tree)
```json
{
  "orchestrator": {
    "agent": "architect",
    "task": "Coordinate work to ship feature X. Spawn specialists as needed."
  }
}
```

### 5) Pool actions (long-lived manual control)
```json
{ "action": "spawn", "id": "impl-1", "agent": "codex-worker", "task": "Implement phase 1" }
{ "action": "send",  "id": "impl-1", "message": "Now add tests and update docs" }
{ "action": "list" }
{ "action": "kill", "id": "impl-1" }
{ "action": "kill-all" }
```

## Per-task overrides

Available on single/tasks/chain steps (and orchestrator root):
- `model`
- `thinking` (`off|minimal|low|medium|high|xhigh`)
- `extensions` (whitelist; subagents run with `-ne`)
- `skills`
- `noTools`
- `noSkills`
- `cwd`

Priority:
`per-task` > `top-level params` > `agent frontmatter` > `global settings`

## Practical routing for this repo

Current project agents in `.pi/agents`:
- `explorer` → deep code tracing/mapping
- `architect` → architecture and phased implementation plans
- `codex-worker` / `opus-worker` → implementation
- `reviewer` → high-confidence review/risk checks
- `simplifier` → cleanup/refinement without behavior changes

Suggested flow:
- Discovery: `explorer`
- Design: `architect`
- Build: `codex-worker` (or `opus-worker` for harder work)
- Verify: `reviewer`
- Polish: `simplifier`

## Safety notes

- Subagents are isolated, but still powerful. Keep extension/tool access minimal.
- For untrusted repos, avoid project agent scope unless explicitly approved.
- Prefer one-shot modes first; use long-lived pool/orchestrator only when needed.
