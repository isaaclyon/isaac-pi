# Vendored ask-user-question

This directory is a local vendored copy of `@juicesharp/rpiv-ask-user-question` so it can be tweaked without waiting on, or being overwritten by, npm package updates.

- Upstream package: `@juicesharp/rpiv-ask-user-question`
- Vendored version: `1.12.0`
- Source package path at vendoring time: `agent/npm/node_modules/@juicesharp/rpiv-ask-user-question`
- Local extension path: `agent/extensions/ask-user-question`

Local notes:

- The Pi tool name is still `ask_user_question` for compatibility with existing prompts and sessions.
- `config.ts` is now self-contained and no longer imports `@juicesharp/rpiv-config`.
- Optional localization still no-ops if `@juicesharp/rpiv-i18n` is not installed, matching upstream behavior.
