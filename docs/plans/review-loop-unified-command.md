# Review Loop Command Unification Plan

## Goal
Simplify the review-loop UX by replacing multiple overlapping commands with a single `/review-loop` command family, including built-in help.

## Context
Current behavior exposes multiple command entry points that overlap with prompt-template flows (`/double-check`, `/double-check-plan`) and legacy review-loop commands. This increases cognitive load and creates discoverability issues.

## Desired Command Surface
Canonical command namespace:

- `/review-loop` → start (default review prompt)
- `/review-loop plan` → start with plan review prompt
- `/review-loop stop`
- `/review-loop status`
- `/review-loop max <n>`
- `/review-loop auto on|off`
- `/review-loop fresh on|off`
- `/review-loop focus <text>`
- `/review-loop help`

## Implementation Steps

### 1) Refactor command handling in extension
File: `.pi/extensions/review-loop/index.ts`

- Introduce a subcommand parser for `/review-loop`.
- Consolidate command actions into shared internal handlers:
  - start default
  - start plan
  - stop
  - status
  - set max
  - set auto
  - set fresh
  - set focus
  - help
- Ensure unknown/malformed input returns actionable usage guidance.

### 2) Add help output
- Implement `/review-loop help`.
- Help should include:
  - all supported forms
  - concise examples
  - default behavior (`/review-loop` starts review)

### 3) Deprecate legacy commands with migration messaging
Legacy commands to deprecate:

- `/review-start`
- `/review-plan`
- `/review-max`
- `/review-exit`
- `/review-status`
- `/review-auto`
- `/review-fresh`

Migration approach:
- Keep temporary aliases.
- Each alias emits a deprecation message with equivalent `/review-loop ...` usage.
- Remove aliases in a later cleanup after adoption.

### 4) Prompt overlap strategy
Files:
- `.pi/prompts/double-check.md`
- `.pi/prompts/double-check-plan.md`

Approach:
- Keep prompt templates for compatibility for now.
- Treat `/review-loop ...` as primary UX.
- Optional follow-up: remove or demote prompt templates once team confirms command-first workflow.

### 5) Preserve tool API
- Keep `review_loop` tool behavior unchanged to avoid breaking agent/tool integrations.
- Ensure command refactor does not alter tool contract.

### 6) Validation
- Run diagnostics on `.pi/extensions/review-loop/index.ts`.
- Validate manual command flows:
  - start, plan, stop, status
  - max/auto/fresh/focus
  - help output
  - deprecated alias behavior
- Confirm tests still pass.

### 7) Documentation update
- Add changelog or notes mapping old commands to new `/review-loop` subcommands.

## Old → New Mapping
- `/review-start` → `/review-loop`
- `/review-plan` → `/review-loop plan`
- `/review-exit` → `/review-loop stop`
- `/review-status` → `/review-loop status`
- `/review-max 5` → `/review-loop max 5`
- `/review-auto on` → `/review-loop auto on`
- `/review-fresh on` → `/review-loop fresh on`

## Acceptance Criteria
- Single `/review-loop` command supports all required behaviors.
- Help is available via `/review-loop help`.
- Legacy commands still work temporarily and warn with migration guidance.
- No TypeScript diagnostics in updated extension.
- Existing `review_loop` tool remains compatible.
