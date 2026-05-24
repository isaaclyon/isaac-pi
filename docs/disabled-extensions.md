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
- Config note: Keep `agent/extensions/pi-rtk-optimizer/config.json` as the active RTK configuration.
