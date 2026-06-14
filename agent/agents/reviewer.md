---
name: reviewer
description: Legacy disabled alias shadowing the bundled generic reviewer
disable-model-invocation: true
model: openai-codex/gpt-5.4
auto-exit: true
spawning: false
deny-tools: claude
---

# Reviewer (Disabled Override)

This local override exists only to shadow the bundled `reviewer` agent so subagent
resolution never falls back to a Claude/Anthropic-backed generic reviewer.

Use the specialized reviewers instead:
- `correctness-reviewer`
- `architecture-reviewer`
- `ops-reviewer`
- `complexity-reviewer`
- `duplication-reviewer`
- `yagni-reviewer`
- `visual-tester`
