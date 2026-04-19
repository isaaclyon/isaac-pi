# Plan: install pi-custom-compaction and configure GPT-5.4-mini

## Goal
Install `pi-custom-compaction` globally and configure Pi to use `openai-codex/gpt-5.4-mini` with `medium` thinking for compaction, triggering at 100K tokens and keeping 30% recent context raw.

## Steps
1. Review Pi package, settings, and compaction docs plus the package README. ✅
2. Install the package through Pi so it is tracked in `agent/settings.json`. ✅
3. Create global `agent/compaction-policy.json` with the requested model, trigger, and retention settings. ✅
4. Verify the installed package and resulting config files. ✅
5. Archive this plan after completion. ✅

## Verification
- `pi install npm:pi-custom-compaction` completed successfully.
- `pi list` now includes `npm:pi-custom-compaction`.
- `agent/compaction-policy.json` parses as valid JSON.
