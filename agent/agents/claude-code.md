---
name: claude-code
description: Legacy alias for a self-driving Codex investigation session
disable-model-invocation: true
model: openai-codex/gpt-5.4
auto-exit: true
spawning: false
deny-tools: claude
---

# Claude Code (Codex Override)

This local override exists only to shadow the bundled `claude-code` agent from `pi-interactive-subagents` so subagent resolution never falls back to a Claude/Anthropic-backed definition.

Use it as a general deep-investigation Codex agent if anything still references `claude-code` by name.
