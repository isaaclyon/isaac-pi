# Ralph loop v1 — Stage 0 contract lock

## Scope locked for v1

A single extension (`agent/extensions/ralph-loop/`) that supervises iterative, isolated child pi runs in tmux until either success conditions are satisfied or global loop limits are reached.

## Core definitions

- **Run**: one top-level Ralph orchestration invocation (has immutable config).
- **Loop**: one child pi execution attempt inside a run.
- **Checkpoint**: structured handoff produced at loop end and passed into the next loop.
- **Deterministic success**: success evaluated only by explicit command assertions (not prose judgment).

## Command contract

### `/ralph-start`

Starts a new run.

Input modes:
1. Inline JSON config
2. Path to JSON config file
3. Preset name (`deterministic-tdd`, `quantitative-only`, `hybrid`) optionally overridden by inline fields

Behavior:
- Reject if config invalid.
- Persist run row + immutable config snapshot.
- Spawn supervisor for loop 1.
- Return run id and active thresholds.

### `/ralph-stop [runId]`

Stops active run (or explicit run id).

Behavior:
- Sends stop signal to supervisor.
- Attempts graceful child termination first, then force kill after timeout.
- Marks run terminal state as `stopped`.

### `/ralph-status [runId]`

Shows one run status (default active run):
- state
- current loop
- latest trigger reason
- latest success evaluation
- child tmux/session health

### `/ralph-runs`

Lists recent runs with summary:
- run id, created time
- task snippet
- state (`running`, `succeeded`, `failed`, `stopped`, `max_loops_reached`)
- loops completed

## Optional tool contract

### `ralph_loop`

Agent-callable interface for limited orchestration actions:
- `start`
- `stop`
- `status`
- `runs`

Hard cut: command path is canonical; tool path is convenience wrapper and mirrors command validation exactly.

## Budget semantics (locked)

Each loop stops when the first configured trigger fires:

1. **Context threshold** (primary):
   - `contextThresholdPercent` (default `50`)
   - Based on child assistant usage telemetry (`usage.totalTokens / modelContextWindowEstimate`).
2. **Assistant turn cap** (optional hard ceiling):
   - `maxAssistantTurns` (default `null`, disabled)
3. **Tool call cap** (optional hard ceiling):
   - `maxToolCalls` (default `null`, disabled)
4. **Global max loops**:
   - `maxLoops` (required)

Tie-break: earliest observed trigger ends loop.

## Success modes (locked)

### 1) Deterministic TDD mode

Required fields:
- `mustFail`: command[]
- `mustPass`: command[]

Rules:
- `mustFail` phase must be observed failing before implementation success is even eligible.
- Success requires all `mustPass` commands exit `0`.
- If `mustFail` unexpectedly passes at baseline, run fails configuration validity (bad test selection).

### 2) Quantitative mode

- `checks`: array of command assertions
- assertion shape:
  - command
  - expectedExitCode (default `0`)
  - optional stdout/stderr regex includes/excludes

### 3) Qualitative mode (optional, explicit)

- Enabled only when `qualitative.enabled = true`.
- Requires deterministic or quantitative checks to be green first unless `qualitative.allowStandalone = true`.
- Output status is marked `qualitative_success` to distinguish from deterministic success.

## Checkpoint contract

Each loop writes one checkpoint with:
- `loopNumber`
- `triggerReason`
- `task`
- `successConditions` (copied immutable)
- `summary` (what changed)
- `artifacts`:
  - modified files (if detectable)
  - test command outputs used in evaluator
  - unresolved blockers
- `nextPrompt`: deterministic handoff prompt for the next loop

Hard cut: next loop always receives the prior checkpoint plus original run instructions and unchanged success conditions.

## Default policy

- No backward compatibility migration.
- Single schema version for v1.
- On evaluator execution error, mark check failed (do not ignore).
- On child process telemetry parse issues, fall back to hard caps if configured; otherwise end loop with `telemetry_error`.
- On stop/abort, prefer clean shutdown then force terminate.

## Initial config shape (v1)

```json
{
  "task": "Implement feature X",
  "maxLoops": 8,
  "budget": {
    "contextThresholdPercent": 50,
    "maxAssistantTurns": null,
    "maxToolCalls": null
  },
  "success": {
    "mode": "deterministic-tdd",
    "mustFail": ["uv run pytest tests/test_x.py -q"],
    "mustPass": ["uv run pytest tests/test_x.py -q"]
  },
  "runner": {
    "cwd": ".",
    "model": null,
    "tools": null,
    "tmuxSessionPrefix": "ralph"
  }
}
```

## Stage 0 outcome

Contract accepted if command names, budgets, and success semantics are approved without ambiguity.
