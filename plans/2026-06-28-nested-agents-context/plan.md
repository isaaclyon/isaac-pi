## Understanding
- Build a small global Pi extension that watches typed filesystem tool calls, discovers nested `AGENTS.md`/`CLAUDE.md` files for accessed folders, and adds those instructions to the effective system-prompt context.
- Existing Pi startup context loading only reads global + cwd/ancestor context files. It does not follow tool access into descendant directories.
- The extension should not parse `bash` command strings. It should use structured tool arguments from `read`, `write`, `edit`, `ls`/`list`, `grep`/`search`, `find`, and future tools with path-like fields.

## Relevant Context
- `agent/extensions/`: auto-discovered global extension location; Pi docs list `~/.pi/agent/extensions/*/index.ts` as a supported global extension shape (`docs/extensions.md:108-119`).
- `dist/core/resource-loader.js:29-74`: current context-file discovery uses candidates `AGENTS.md`, `AGENTS.MD`, `CLAUDE.md`, `CLAUDE.MD`, one file per directory, ordered global then shallow-to-deep cwd ancestors.
- `dist/core/system-prompt.js:102-109`: project context is rendered as `<project_context>` containing `<project_instructions path="...">...` blocks. Mirror this format for nested context.
- `dist/core/agent-session.js:643-658`: base system-prompt options come from the resource loader’s loaded context files; extensions can’t currently add files to that loader from a tool hook.
- `dist/core/agent-session.js:802-823` and `docs/extensions.md:497-532`: `before_agent_start` is the provider-independent hook for replacing the system prompt, but it runs only before a user prompt’s agent loop.
- `docs/extensions.md:596-617`: `tool_execution_start` exposes all tool names and raw args in assistant order; this is the right observation point when no mutation/blocking is needed.
- `docs/extensions.md:632-637`: `before_provider_request` can patch provider payloads, but that is provider-specific and not reflected by `ctx.getSystemPrompt()`.
- `agent/packages/usage-analytics/extensions/usage-tracker.ts:38-55,207-260`: good local pattern for typed-tool event observation plus `@`/`~`/realpath normalization.
- `agent/extensions/model-aware-compaction/index.ts:95-105,215-245`: confirms system prompt is separate from session messages and shows reset points on session start/tree/compaction.
- Built-in tool schemas expose path fields: `read` path (`read.d.ts:5-9`), `write` path (`write.d.ts:4-7`), `edit` path (`edit.d.ts:10-17`), optional `grep`/`find` path (`grep.d.ts:5-14`, `find.d.ts:5-10`), optional `ls` path (`ls.d.ts:5-9`).

## Assumptions / Open Questions
- Assumption: a provider-independent extension is preferred over brittle `before_provider_request` payload rewriting. Therefore context discovered during a tool call becomes active on the next `before_agent_start` (normally the next user prompt), not necessarily the same in-flight model continuation.
- If same in-flight continuation is a hard requirement, first add a Pi core API/hook to update `agent.state.systemPrompt` or system-prompt context files between tool turns. I would not implement that by parsing every provider payload in this extension.
- Assumption: load nested context only for paths inside the current session `cwd` realpath tree. Ignore external paths to avoid surprising prompt injection from unrelated directories.
- Assumption: “once per session/compaction window” means read each discovered context file at most once after each reset, then include the loaded content in every system prompt until the next reset.

## Recommended Approach
- Add a vendored extension at `agent/extensions/nested-agents-context/` with a small pure helper module and an `index.ts` entrypoint.
- Observe `tool_execution_start` and inspect structured `event.args`; do not inspect `input` text or parse `bash` commands.
- Use explicit extraction for built-ins/aliases and conservative generic extraction for future tools: string or string-array values under keys like `path`, `paths`, `filePath`, `dir`, `directory`, `root`, `targetPath`, `sourcePath`, `destinationPath`. Do not treat `pattern`, `glob`, `content`, or command strings as paths.
- Normalize candidate paths like usage analytics (`@` removal, `~` expansion, relative-to-`ctx.cwd`, `realpathSync.native` when possible). For writes to missing targets, resolve the existing parent and search from that parent.
- Discover context files from the accessed directory upward to `ctx.cwd`, emit them shallow-to-deep, mirror Pi’s candidate order, and dedupe against both startup context files and already-discovered nested files.
- Inject by appending a nested `<project_context>` block to `event.systemPrompt` in `before_agent_start`, preserving any earlier extension changes in the chain.
- Reset loaded/dedup state on `session_start`, `session_tree`, `session_before_compact`, `session_compact`, and `session_shutdown`.
- Keep runtime quiet: no transcript messages and no UI notifications. At most use guarded debug logging if a `PI_NESTED_AGENTS_CONTEXT_DEBUG` env flag is added.

## Implementation Steps
1. Create `agent/extensions/nested-agents-context/context.ts` with pure helpers:
   - `expandHome`, `normalizeCandidatePath`, `resolveStartDirectory`.
   - `extractPathCandidates(toolName, args)` with built-in/alias handling and conservative generic path-key scanning.
   - `discoverInstructionFiles(startDir, cwd)` mirroring Pi candidate names/order and cwd-boundary checks.
   - `formatProjectContext(files)` using Pi’s `<project_context>` / `<project_instructions>` shape.
2. Add `agent/extensions/nested-agents-context/index.ts`:
   - Maintain `baseContextPaths`, `loadedInstructionPaths`, and ordered `loadedInstructionFiles` maps/arrays.
   - On `before_agent_start`, refresh `baseContextPaths` from `event.systemPromptOptions.contextFiles`, filter loaded nested files against it, and return `systemPrompt: event.systemPrompt + ...` only when there is nested context.
   - On `tool_execution_start`, extract paths, discover instruction files, read new files once, and append to loaded state in deterministic order.
   - Register reset handlers for session start/tree/compaction/shutdown.
3. Add focused tests under `agent/extensions/nested-agents-context/`:
   - Path extraction covers built-ins, aliases, future path-like fields, `@`, `~`, relative paths, and ignores `bash.command`, `pattern`, `glob`, and `content`.
   - Discovery handles one file per directory, shallow-to-deep order, AGENTS-over-CLAUDE precedence, symlink/realpath dedupe, missing/unreadable files no-op, and cwd-boundary ignoring.
   - Event tests with a mock `pi` verify tool observation, no duplicate reads/injection within a window, base context dedupe, and resets on session/compaction events.
4. Add a short `README.md` or top-of-file comment documenting behavior and the same-in-flight-turn limitation so future maintainers do not “fix” it with provider payload parsing accidentally.

## Verification
- Unit/event tests: `node --test agent/extensions/nested-agents-context/*.test.ts`.
- Manual smoke, if desired: create a temp project with `AGENTS.md` at root and `sub/AGENTS.md`, run Pi with the extension, access `sub/...` via `read`/`ls`, then verify a subsequent prompt’s system prompt includes the nested block (or add a temporary debug assertion/log while developing).
- Regression check that no code inspects `bash` command strings: targeted test plus `rg "command" agent/extensions/nested-agents-context`.

## Risks
- Same-turn timing: a provider-independent extension cannot update the already-started agent loop’s system prompt after a tool call; solving that properly needs Pi core support.
- Token growth: deeply nested or large instruction files can bloat prompts; this mirrors root context behavior but may need a future size policy.
- Generic path-key scanning can miss unusual future tool field names or misclassify a rare non-path field. Keep it conservative and covered by tests.
- Cwd-boundary restriction may skip intentional external workspace access; relax only with an explicit config/decision.
