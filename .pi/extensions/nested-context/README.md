# nested-context extension

Auto-loads nested instruction files in monorepos when the agent first touches a file path via `read`, `edit`, or `write`.

## Default behavior

For each directory on the touched file's path back to `cwd`:

1. Use `AGENTS.md` if present
2. Otherwise use `CLAUDE.md` as fallback

That means Pi gets per-subtree instructions on demand, instead of only the startup `cwd` walk-up files.

## Config

Create `.pi/nested-context.json` in the target repo (the repo where Pi is running):

```json
{
  "enabled": true,
  "fileSelectionMode": "agents-first-fallback-claude",
  "strictFirstHit": true,
  "maxChars": 12000,
  "notifyOnLoad": true,
  "refreshOnChange": true,
  "includeCwdLevelFile": false
}
```

### `fileSelectionMode`

- `"agents-first-fallback-claude"` (default)
- `"agents-only"`
- `"claude-only"`
- `"both"`

## Injection behavior

- Loaded nested files are added to the **system prompt** on `before_agent_start`.
- If new files are discovered **mid-agent-run** (during tool calls), the extension also injects a clearly wrapped instruction update in the `context` hook so the active run can immediately see them.

## Notes

- `strictFirstHit: true` blocks the first triggering tool call after new rules are discovered, so the model retries with updated rules in context.
- Rules are injected with nearest-directory precedence (deeper path wins).
- Paths outside `cwd` are ignored.
- This extension does not parse arbitrary shell commands for file paths.
