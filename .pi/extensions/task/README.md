# Task Extension

Coordinate parallel and sequential work by delegating prompts to isolated `pi` subprocesses via the built-in `task` tool.

## Failure visibility and troubleshooting

The task tool intentionally keeps output concise by default.
If a task fails, you still get an error summary (for example, `task failed`), but detailed failure context is optional.

To enable verbose structured failure logs, set one of the following environment variables before launching `pi`:

- `PI_AGENT_VERBOSE=true`
- `PI_AGENT_VERBOSE=1`
- `PI_AGENT_VERBOSE=yes`
- `PI_AGENT_VERBOSE=on`

With verbose mode enabled, failed tasks include a technical section with:

- **Command** (subprocess command + arguments; final prompt arg is redacted)
- **Working directory**
- **Start / end timestamps**
- **Wall duration in milliseconds**
- **Failure source** (`exit`, `timeout`, `aborted`, `spawn_error`, `tool_error`)
- **Exit code / stop reason**
- **Tool error name/message/stack** (if available)
- **Full captured stdout/stderr**

When using `task` in parallel mode, each failed subtask is now marked as failed even if the child process exits `0` but a nested tool call reported an error.

## Notes

- `PI_AGENT_VERBOSE` defaults to disabled (`false`) so logs stay compact in normal operation.
- Per-task `cwd` must be a relative subdirectory under the parent working directory. Absolute paths and `..` escapes are rejected.
- Timeout values must be `> 0` and `<= 2147483` seconds (Node timer-safe bound).
- If you need to diagnose a silent failure, rerun with `PI_AGENT_VERBOSE=true` and compare the `Failure details` block.
