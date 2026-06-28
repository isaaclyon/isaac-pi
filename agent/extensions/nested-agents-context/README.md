# nested-agents-context

Global Pi extension that observes typed filesystem tool arguments and loads nested
`AGENTS.md` / `CLAUDE.md` instructions for accessed project subdirectories.

Behavior:
- observes structured tool args only (`read`, `write`, `edit`, `ls`/`list`, `grep`/`search`/`find`, plus conservative future path-like fields)
- does not parse shell text
- searches only inside the current session `cwd` realpath tree
- reads one instruction file per directory using Pi's precedence: `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`
- appends discovered files to the next `before_agent_start` system prompt using Pi's `<project_context>` / `<project_instructions>` shape
- resets loaded files on session start, tree navigation, compaction, and shutdown

Provider-independent prompt injection happens on the next `before_agent_start`.
Same in-flight tool-continuation behavior would require Pi core support; this
extension intentionally avoids provider-payload rewriting.

Verify with:

```sh
node --test agent/extensions/nested-agents-context/*.test.ts
```

The test set includes a live Pi `ExtensionRunner` smoke test that loads the
extension through Pi's extension discovery/loader and verifies next-turn system
prompt injection after a typed `tool_execution_start` event. It does not call an
LLM or exercise the interactive TUI.
