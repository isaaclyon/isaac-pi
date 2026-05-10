# Plan: model-aware compaction

## Goal
Configure Pi to compact earlier for GPT models by lowering built-in reserve tokens and installing/configuring `pi-model-aware-compaction` with a global `gpt-*` threshold around 60%.

## Steps
1. Lower core compaction reserve tokens in `agent/settings.json` and add the package entry.
   - Verify: settings file contains the new package and compaction settings.
2. Install `pi-model-aware-compaction`.
   - Verify: package is present in Pi's installed packages / extension files exist.
3. Add extension config for a 60% `gpt-*` threshold.
   - Verify: `config.json` exists in the extension directory with the expected values.
