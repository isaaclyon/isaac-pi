# Disabled/Removed Pi Extensions

This file records extensions that were removed or disabled so they can be recalled later.

## LCM extension

- Package: `npm:pi-lcm`
- Removed: 2026-05-23
- Reason: Replaced with `npm:@sting8k/pi-vcc`
- Reinstall command: `pi install npm:pi-lcm`
- Config note: `agent/settings.json` may retain an `lcm` block with `enabled: false` as historical configuration.

## rpiv ask-user-question npm package

- Package: `npm:@juicesharp/rpiv-ask-user-question`
- Removed: 2026-05-23
- Reason: Vendored as `agent/extensions/ask-user-question` so local tweaks are tracked in this repo and not overwritten by package updates.
- Reinstall command: `pi install npm:@juicesharp/rpiv-ask-user-question`
- Config note: The vendored extension keeps the runtime tool name `ask_user_question` for compatibility.

## pi-rtk simple rewrite extension

- Package: `npm:@sherif-fanous/pi-rtk`
- Removed: 2026-05-23
- Reason: Redundant with `npm:pi-rtk-optimizer@0.7.1`, which provides RTK command rewriting plus output compaction and `/rtk` settings. Keeping both created overlapping RTK behavior and duplicate `/rtk` commands.
- Reinstall command: `pi install npm:@sherif-fanous/pi-rtk`
- Config note: The replacement optimizer was later removed on 2026-07-11; its local configuration was deleted.

## Codex fast mode extension

- Package: `npm:pi-codex-fast`
- Removed: 2026-05-24
- Reason: Removed on request.
- Reinstall command: `pi install npm:pi-codex-fast`
- Config note: `agent/extensions/pi-codex-fast.json` is deleted.

## pi-subagent package

- Package: `npm:@mjakl/pi-subagent@1.4.1`
- Removed: 2026-06-11
- Reason: Configured with `extensions: []`, so it was effectively disabled and removed for cleanup.
- Reinstall command: `pi install npm:@mjakl/pi-subagent@1.4.1`
- Config note: Re-adding the package entry to `agent/settings.json` is also enough to restore it.

## pi-cmux package

- Package: `git:github.com/sasha-computer/pi-cmux`
- Removed: 2026-06-11
- Reason: Configured with empty `extensions`, `skills`, `prompts`, and `themes`, so it was effectively disabled and removed for cleanup.
- Reinstall command: `pi install git:github.com/sasha-computer/pi-cmux`
- Config note: Re-adding the package entry to `agent/settings.json` is also enough to restore it.

## pi-vcc package

- Package: `npm:@sting8k/pi-vcc`
- Removed: 2026-07-04
- Reason: Removed on request.
- Reinstall command: `pi install npm:@sting8k/pi-vcc`
- Config note: `agent/pi-vcc-config.json` is deleted.

## pi-rtk-optimizer

- Package: `npm:pi-rtk-optimizer@0.7.1`
- Removed: 2026-07-11
- Reason: Removed on request.
- Reinstall command: `pi install npm:pi-rtk-optimizer@0.7.1`
- Config note: The global package and local configuration were deleted.

## pi-lcm-memory

- Package: `npm:pi-lcm-memory`
- Removed: 2026-07-11
- Reason: Removed on request.
- Reinstall command: `pi install npm:pi-lcm-memory`

## pi-chrome-devtools

- Package: `npm:@narumitw/pi-chrome-devtools`
- Removed: 2026-07-11
- Reason: Removed on request.
- Reinstall command: `pi install npm:@narumitw/pi-chrome-devtools`

## pi-interactive-subagents

- Package: `./packages/pi-interactive-subagents`
- Disabled: 2026-07-11
- Reason: Disabled on request while retaining the local package for possible later re-enablement.
- Config note: The package remains in `agent/settings.json` with an empty `extensions` list.
