# Skill autocomplete for `$` tokens

## Goal
Add a Pi autocomplete provider that suggests skill names when the user types `$` followed by a partial skill name.

## Plan
1. Add a focused test suite for token extraction, filtering, and provider fallback behavior.
2. Implement a small autocomplete helper that detects `$`-prefixed skill tokens and returns matching skill names.
3. Wire the helper into a session-start extension so Pi registers the provider automatically.
4. Verify the extension still falls back to the existing autocomplete provider when no skill token is present or when there are no matches.
