# Ralph Loop Extension

Ralph Loop runs a task in iterative child loops, persists run state in SQLite, and evaluates success with deterministic/quantitative/hybrid/qualitative modes.

## Quickstart

1. Enable Ralph in your repo config:

```json
{
  "enabled": true,
  "dbPath": "/absolute/path/to/ralph-loop.sqlite",
  "defaultRun": {
    "task": "Implement feature X",
    "maxLoops": 8,
    "budget": {
      "contextThresholdPercent": 50,
      "maxAssistantTurns": null,
      "maxToolCalls": null
    },
    "success": {
      "mode": "quantitative",
      "checks": [{ "command": "echo ok", "stdoutIncludes": "ok" }]
    },
    "runner": {
      "cwd": ".",
      "model": null,
      "tools": null,
      "tmuxSessionPrefix": "ralph",
      "modelContextWindowTokens": 200000
    }
  }
}
```

Save as: `.pi/ralph-loop.json`

2. Start a run:

```text
/ralph-start
```

If `defaultRun.task` is empty, pass inline config:

```text
/ralph-start {"task":"Ship stage","maxLoops":3,"success":{"mode":"quantitative","checks":[{"command":"echo ok"}]}}
```

3. Monitor and control:

```text
/ralph-status
/ralph-runs
/ralph-stop
```

## Command Reference

### `/ralph-start <config-or-preset>`
Starts a run in background and returns a `runId`.

Accepted inputs:
- empty args: use configured default run
- inline JSON config
- path to JSON config file
- preset name (`deterministic-tdd`, `quantitative-only`, `hybrid`)
- preset + inline JSON override (e.g. `hybrid { ... }`)

### `/ralph-stop [runId]`
Stops an active run in the current session. If no `runId` is passed, Ralph targets the latest active/default run.

### `/ralph-status [runId]`
Shows:
- run id/state
- loop progress
- configured thresholds
- latest trigger
- latest evaluator result
- child health (active/inactive)

### `/ralph-runs`
Lists recent runs with state and loop progress.

## Tool Contract (`ralph_loop`)

Pi can parse natural language into a structured tool call using `ralph_loop`.

Actions:
- `start`
- `stop`
- `status`
- `runs`

### `ralph_loop` start shape

```json
{
  "action": "start",
  "cwd": "/Users/isaaclyon/.pi",
  "preset": "quantitative-only",
  "task": "Fix flaky parser tests and stop when checks pass",
  "maxLoops": 6,
  "budget": {
    "contextThresholdPercent": 40,
    "maxAssistantTurns": null,
    "maxToolCalls": null
  },
  "success": {
    "mode": "quantitative",
    "checks": [{ "command": "npm test", "expectedExitCode": 0 }]
  }
}
```

Notes:
- Any omitted fields fall back to `defaultRun` values.
- Validation is identical to slash command path (hard-cut; malformed payloads are rejected).

### `ralph_loop` control examples

```json
{ "action": "status", "runId": "ralph_..." }
{ "action": "runs", "limit": 10 }
{ "action": "stop", "runId": "ralph_..." }
```

## Success Presets

### `deterministic-tdd`
Use strict red/green commands:

```text
/ralph-start deterministic-tdd {"task":"Fix parser tests","success":{"mode":"deterministic-tdd","mustFail":["npm test test/parser.red.test.ts"],"mustPass":["npm test test/parser.red.test.ts"]}}
```

### `quantitative-only`
Use command checks only:

```text
/ralph-start quantitative-only {"task":"Improve coverage","success":{"mode":"quantitative","checks":[{"command":"npm test","expectedExitCode":0}]}}
```

### `hybrid`
Combine deterministic + quantitative (+ optional qualitative):

```text
/ralph-start hybrid {"task":"Implement feature","success":{"mode":"hybrid","deterministic":{"mustFail":["npm test test/red.test.ts"],"mustPass":["npm test test/red.test.ts"]},"quantitative":{"checks":[{"command":"npm run lint"}]},"qualitative":{"allowStandalone":false}}}
```

## Validation Rules (Hard Cut)

Ralph rejects invalid `success` payloads at start-time (no silent fallback):
- invalid/missing `mode`
- non-array deterministic command lists
- empty/invalid quantitative checks
- non-numeric `expectedExitCode`
- invalid hybrid shape (must include at least one of deterministic/quantitative/qualitative)

## Persistence

Ralph persists runs/loops/events/checkpoints in SQLite and can read prior run history via `/ralph-runs` and `/ralph-status`.

## UI + Non-UI Behavior

- With UI: Ralph sets status text via `ctx.ui.setStatus("ralph", ...)` and command notifications via `ctx.ui.notify(...)`.
- Without UI: Ralph falls back to `pi.sendUserMessage(...)`.

## Troubleshooting

- **"Ralph loop is disabled"**
  - Set `enabled: true` in `.pi/ralph-loop.json`, or set `PI_RALPH_ENABLED=1`.
- **"Invalid Ralph config"**
  - Check `success` schema and command types.
- **Run won't stop**
  - Use `/ralph-stop [runId]`; current implementation propagates abort signal to active loop execution and requests child stop.
- **No runs listed**
  - Confirm `dbPath` points to the expected SQLite file and that run creation succeeded.
