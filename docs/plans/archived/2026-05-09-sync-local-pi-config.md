# Sync local Pi config to isaac-pi

Goal: replace the GitHub `isaac-pi` repo contents with the current portable local Pi setup.

Included:
- Global Pi settings, including installed package sources.
- Local system prompt append.
- Local subagent definitions.
- Local/self-made extensions and extension config.
- Local prompt templates and skills.
- Local helper binary directory.

Excluded:
- Secrets (`auth.json`).
- Runtime state (`sessions/`, `lcm/`, memory DBs, caches/history).
- Installed package clones under `agent/git/`; `settings.json` remains the source of truth.

Verification:
- Ensure no known secret/runtime paths are staged.
- Commit and push to `isaaclyon/isaac-pi` main.
