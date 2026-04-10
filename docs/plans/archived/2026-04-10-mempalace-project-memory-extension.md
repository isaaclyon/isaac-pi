# MemPalace per-project memory pi extension plan

- **Date:** 2026-04-10
- **Status:** Completed (archived)
- **Owner:** pi coding agent

## Goal

Add a **project-local pi extension** that gives pi a **per-project long-term memory** backed by MemPalace, with a narrow MVP scope:

1. Store memory **inside the repo** at `.pi/memory/mempalace/`
2. Expose a **manual search tool** for querying project memory
3. Expose a **manual sync command/tool** for ingesting pi session content into MemPalace
4. Use **local Python helper scripts** as the integration layer between the TypeScript extension and MemPalace

## Scope decisions

Chosen with the user before planning:

- **Initial scope:** MVP: per-project storage + manual search + manual sync
- **Storage default:** repo-local under `.pi/memory/mempalace`
- **Integration style:** pi extension -> local Python helper scripts
- **Deliverable for this step:** design/implementation plan only
- **Completion note:** implemented under `agent/extensions/mempalace/` with Vitest coverage and helper-script integration tests

## Non-goals for MVP

These are explicitly deferred until after the first version works:

- Automatic sync on shutdown or before compaction
- Automatic memory injection before turns
- Rich hall/room classification heuristics
- Cross-project memory or federated search
- TUI widgets, dashboards, or reset UX beyond minimal commands
- Wrapping MemPalace MCP inside pi

## Proposed repo layout

```text
.pi/
  extensions/
    mempalace/
      index.ts
      package.json
      README.md
      helpers/
        common.py
        search.py
        sync.py
        status.py
  memory/
    mempalace/
      state.json
      palace/             # actual MemPalace storage if needed by helper layout
      ingest/
        pi-session/       # normalized transcript chunks written by sync
```

Notes:
- Keep all project memory state under `.pi/memory/mempalace/`
- Ignore `.pi/memory/` in git unless the user later wants memory committed
- Helper scripts should treat `.pi/memory/mempalace/` as the single project boundary

## Architecture

### 1) pi extension layer

Responsibilities:
- Discover current project context from `ctx.cwd`
- Register custom tools and commands
- Read pi session entries via `ctx.sessionManager`
- Marshal data into helper-friendly payloads
- Render concise search/sync results back to the LLM/user
- Persist extension-level metadata in pi session entries where useful

Initial extension surface:

#### Tools
- `project_memory_search`
  - Search long-term memory for the current project only
- `project_memory_sync`
  - Ingest unsynced session content into MemPalace
- `project_memory_status`
  - Report current setup, cursor, indexed item counts, helper availability

#### Commands
- `/memory-search <query>`
  - Convenience wrapper for interactive use
- `/memory-sync`
  - Manual sync trigger
- `/memory-status`
  - Quick diagnostics

### 2) Python helper layer

Responsibilities:
- Validate environment and MemPalace availability
- Normalize extension input payloads
- Create/read the project-local palace
- Execute search and sync operations in a stable way
- Return structured JSON results to the extension

Why a helper layer instead of direct CLI calls:
- Keeps MemPalace-specific logic out of the extension
- Gives us a stable contract even if MemPalace CLI details change
- Makes errors and environment validation easier to centralize
- Leaves room to switch from CLI calls to direct Python API usage later

### 3) Project-local memory store

Default path:
- `.pi/memory/mempalace/`

Recommended internal structure:
- `state.json` — repo-level metadata and sync cursor cache
- `ingest/pi-session/` — normalized saved transcript chunks
- `palace/` — MemPalace-managed data location if separate directory is useful

## Data model

### Extension state

Track at minimum:

```json
{
  "version": 1,
  "projectRoot": "/abs/path/to/repo",
  "projectWing": "wing_<repo>",
  "lastSync": {
    "sessionFile": "...jsonl",
    "entryId": "abcd1234",
    "timestamp": "2026-04-10T12:34:56.000Z"
  }
}
```

### Sync cursor strategy

Use both:

1. **Repo-local state file** at `.pi/memory/mempalace/state.json`
2. **Optional pi custom entry** via `pi.appendEntry("mempalace-state", ...)` for branch-aware recovery

For MVP, the repo-local state file is the main source of truth. Session custom entries can be added if branch-aware sync becomes necessary during implementation.

### Memory boundaries

- One repo = one project memory store
- Searches are scoped to the current repo only
- The wing name is derived from the repo basename and sanitized

Example:
- repo: `/work/foo-bar`
- wing: `wing_foo_bar`

## Session ingestion design

### Input source

Use pi session entries from:
- `ctx.sessionManager.getBranch()` for current branch-local sync behavior

Reasoning:
- Branch-local behavior is safer than syncing every historical branch by default
- Keeps the first version conceptually simple

### What to ingest in MVP

Include:
- user messages
- assistant text responses
- tool result summaries that are likely useful
- lightweight metadata about touched files when detectable

Exclude or heavily trim:
- large raw command output dumps
- repetitive status messages
- purely cosmetic extension messages

### Normalized sync unit

Each synced chunk should be written as a structured transcript record before helper ingest.

Example shape:

```json
{
  "source": "pi-session",
  "sessionFile": "...jsonl",
  "entryStartId": "a1",
  "entryEndId": "b2",
  "projectRoot": "/abs/path/to/repo",
  "projectWing": "wing_repo",
  "createdAt": "2026-04-10T12:34:56.000Z",
  "messages": [
    {"role": "user", "text": "why did auth fail in staging?"},
    {"role": "assistant", "text": "Likely stale webhook secret..."},
    {"role": "toolResult", "toolName": "grep", "text": "Found AUTH_WEBHOOK_SECRET in ..."}
  ],
  "metadata": {
    "filesTouched": ["src/auth/webhooks.ts"],
    "gitBranch": "feature/memory"
  }
}
```

### Chunking rule for MVP

Start simple:
- sync the entire unsynced tail of the current branch as one chunk per manual sync

This is the lowest-risk implementation. If chunk size becomes problematic, split later by user/assistant turn boundaries.

## Search design

### Tool contract

`project_memory_search` input:

```json
{
  "query": "why did we switch auth providers?"
}
```

Return:
- concise text summary for the model
- structured details with raw hits, sources, and metadata

Search behavior:
- always scoped to current project wing
- no cross-project lookup in MVP
- return verbatim excerpts where possible

### Result rendering

The tool result should include:
- hit count
- top matches with short excerpts
- source session metadata
- any tracked files or timestamps

Keep the top-level text compact so it is useful in-model without flooding context.

## Helper contract

The extension and helper scripts should communicate with JSON over stdin/stdout.

### `status.py`
Input:
```json
{
  "projectRoot": "/abs/path/to/repo",
  "memoryRoot": "/abs/path/to/repo/.pi/memory/mempalace"
}
```

Output:
```json
{
  "ok": true,
  "mempalaceAvailable": true,
  "memoryRoot": "...",
  "projectWing": "wing_repo",
  "lastSync": {...},
  "stats": {
    "ingestFiles": 3,
    "indexedItems": 3
  }
}
```

### `sync.py`
Input:
```json
{
  "projectRoot": "...",
  "memoryRoot": "...",
  "projectWing": "wing_repo",
  "cursor": {...},
  "chunk": {...normalized transcript chunk...}
}
```

Output:
```json
{
  "ok": true,
  "saved": true,
  "indexedCount": 1,
  "lastSync": {...},
  "warnings": []
}
```

### `search.py`
Input:
```json
{
  "projectRoot": "...",
  "memoryRoot": "...",
  "projectWing": "wing_repo",
  "query": "auth decision"
}
```

Output:
```json
{
  "ok": true,
  "hits": [
    {
      "score": 0.91,
      "excerpt": "Chose Clerk over Auth0 because...",
      "source": {
        "sessionFile": "...",
        "entryStartId": "...",
        "createdAt": "..."
      }
    }
  ]
}
```

## Error handling

Follow repo engineering rules: fail loudly.

The extension should:
- surface helper stderr and non-zero exits clearly
- distinguish setup errors from search misses
- never silently skip a requested sync

Expected error classes:
- MemPalace not installed/importable
- helper runtime failure
- malformed state file
- missing memory directory
- unsupported session entry shape

## Verification strategy

### Unit/integration targets

#### TypeScript extension
- wing/path derivation
- session entry normalization
- cursor selection and update rules
- helper invocation and JSON parsing
- tool output shaping

#### Python helpers
- state initialization
- sync payload validation
- search payload validation
- expected JSON response schema
- MemPalace availability checks

### End-to-end target

Manual test flow:
1. Start pi in a test repo with the extension enabled
2. Create a short session with one or two technical decisions
3. Run `/memory-sync`
4. Confirm files appear under `.pi/memory/mempalace/`
5. Run `project_memory_search` / `/memory-search`
6. Verify the earlier decision is returned

## Incremental implementation phases

### Phase 1 — scaffold
- Create extension directory and package metadata
- Create helper script layout
- Create memory root initialization logic
- Add repo-local ignore entry if appropriate

### Phase 2 — status path
- Implement `project_memory_status`
- Implement helper availability checks
- Implement state file read/write helpers

### Phase 3 — sync path
- Implement session entry normalization in TypeScript
- Implement `project_memory_sync`
- Write normalized transcript chunk to disk
- Call Python `sync.py`
- Update cursor after successful sync only

### Phase 4 — search path
- Implement `project_memory_search`
- Call Python `search.py`
- Render compact useful results
- Add `/memory-search` command wrapper

### Phase 5 — hardening
- Add tests
- Verify failure cases
- Document setup and operating expectations

## Risks and mitigations

### Risk: MemPalace CLI/API instability
Mitigation:
- keep all MemPalace-specific logic in Python helpers
- define a narrow JSON contract with the extension

### Risk: Oversyncing noisy transcript content
Mitigation:
- start with conservative normalization
- strip large raw outputs
- sync manually only in MVP

### Risk: Branch confusion in pi sessions
Mitigation:
- use current branch only for MVP
- avoid trying to merge all session branches initially

### Risk: Environment friction from Python deps
Mitigation:
- provide one clear helper check in `project_memory_status`
- emit actionable install/setup errors

### Risk: Large sync chunks hurting search quality
Mitigation:
- start simple, but keep transcript-chunk writer isolated so chunking can change later

## Open questions for implementation

These do not block the current plan, but must be decided while implementing:

1. Should helpers call MemPalace via CLI or import its Python package directly?
   - Plan assumption: start with whichever is more reliable locally, hidden behind helpers
2. Should normalized transcript chunks be stored permanently in `ingest/pi-session/` or treated as transient staging files?
   - Plan assumption: keep them for debuggability in MVP
3. Should sync include tool results for all tool types or only a curated allowlist?
   - Plan assumption: curated allowlist / trimmed summaries
4. Should the extension also write pi custom entries for branch-aware sync state now or later?
   - Plan assumption: later unless implementation reveals clear need

## Recommended first implementation order

1. Build `project_memory_status`
2. Build helper bootstrap and state management
3. Build manual sync end-to-end
4. Build search end-to-end
5. Add command wrappers and tests

## Acceptance criteria for MVP

- A project-local extension loads from `.pi/extensions/mempalace/`
- The extension creates and uses `.pi/memory/mempalace/`
- A user can manually sync the current pi session branch into project memory
- A user can manually search that project memory from pi
- Search results are scoped to the current repo only
- Failures are surfaced clearly with actionable messages
- No automatic background sync or automatic memory injection exists yet
