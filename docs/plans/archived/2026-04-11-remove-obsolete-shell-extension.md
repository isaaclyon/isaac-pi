# Remove obsolete shell extension

## Goal
Remove the obsolete shell extension from `agent/extensions/` and clean up any current references to that extension in repo prompts/docs/config without touching unrelated `interactive_shell` tool guidance.

## Acceptance criteria
- [x] The obsolete shell extension file is removed.
- [x] Current repo references to that extension are removed.
- [x] Unrelated `interactive_shell` tool instructions remain intact.
- [x] Verification confirms no current extension-name references remain.

## Notes
- Keep historical archived plans intact unless they are the only remaining references.
- Prefer the smallest safe cleanup.

## Verification
- Removed the obsolete shell extension file from `agent/extensions/`.
- Confirmed `agent/extensions/` no longer contains the file.
- Searched the repo for the extension name and confirmed no matches remain after archiving.
