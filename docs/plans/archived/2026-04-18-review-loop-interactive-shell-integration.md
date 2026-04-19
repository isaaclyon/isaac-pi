# Review loop interactive-shell integration

## Goal
Replace the current separate-terminal review worker launcher with an in-session overlay powered by `pi-interactive-shell`, while also:
- defaulting review workers to `openai-codex/gpt-5.4-mini`
- defaulting review workers to `--thinking high`
- keeping review mode active across normal user messages until explicit exit, max-iterations, or a clean stop result

## Confirmed requirements
- Do **not** open a new terminal/window.
- Use `pi-interactive-shell`'s overlay/widget approach instead.
- Treat `pi-interactive-shell` as **required** for review-worker execution.
- If the user sends normal chat messages during review mode, keep review running continuously.

## Findings
- `pi-interactive-shell` already provides an embeddable overlay implementation via internal files such as:
  - `overlay-component.ts`
  - `config.ts`
  - `types.ts`
- Pi extension API does **not** expose a direct "call another tool" method, so `pi-review-loop` should not rely on asking the model to invoke `interactive_shell`.
- The lowest-risk integration path is to depend on `pi-interactive-shell` as an npm dependency and reuse its overlay/runtime internals directly.
- Existing worker-session result/progress files are still useful and should be preserved for deterministic pass completion and touched-file updates.

## Implementation plan
1. Add failing tests for the new behavior:
   - review mode no longer exits on ordinary interactive input
   - worker launch path uses interactive-shell-backed overlay flow instead of Terminal.app spawning
   - review worker args include default model + thinking flags
2. Refactor worker launching:
   - replace Terminal.app/osascript launcher path with a `pi-interactive-shell` overlay-backed launcher
   - keep result/progress/pid temp files and worker-session parsing intact
3. Update review-loop control flow:
   - remove the `user interrupted` auto-exit on `input`
   - keep current overlay/status active while review continues asynchronously
4. Update package/docs:
   - add required dependency wiring in `package.json`
   - update README to explain the interactive-shell requirement and new in-session behavior
5. Verify:
   - targeted vitest suite
   - LSP diagnostics clean
   - commit package changes

## Notes
- Prefer the smallest safe integration surface from `pi-interactive-shell`.
- Avoid fallback paths to the old Terminal.app launcher.
