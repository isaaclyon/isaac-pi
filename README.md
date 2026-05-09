# isaac-pi

Personal Pi setup mirror.

This repo intentionally tracks the portable parts of `~/.pi/agent`:

- `agent/settings.json` — installed package sources and model/config defaults
- `agent/APPEND_SYSTEM.md` — system prompt append
- `agent/agents/` — subagent definitions
- `agent/extensions/` — local/self-made extensions and local extension config
- `agent/prompts/` — prompt templates
- `agent/skills/` — local skills
- `agent/bin/` — local helper binaries used by the setup

It intentionally excludes secrets and runtime state: `auth.json`, sessions, LCM databases, memory databases, installed package clones, npm caches, and update caches.

## Restore onto a machine

Review the files first, then from the repo root:

```sh
rsync -a agent/ ~/.pi/agent/
```

Then start Pi. Package installs are driven by `agent/settings.json`; Pi will install missing packages on startup/update.
