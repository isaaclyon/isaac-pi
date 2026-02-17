# Loop Extension: Handoff-Style Compaction

## Reference

- Original loop extension: https://github.com/mitsuhiko/agent-stuff/blob/main/pi-extensions/loop.ts
- Local handoff extension: `.pi/extensions/handoff.ts`
- Pi compaction internals: `@mariozechner/pi-coding-agent/dist/core/compaction/compaction.js`

## Problem

The loop extension keeps an agent working in a loop until a breakout condition is met (tests pass, custom condition, or agent self-reports done). Currently it runs in a single session and relies on pi's default compaction when context gets large. Two issues:

1. **Default compaction is lossy and not loop-aware.** The summary is a generic checkpoint — it doesn't emphasize what was tried, what failed, and what to do next. The agent loses important context about prior loop iterations.

2. **The agent decides when to stop or hand off.** The `signal_loop_success` tool requires the agent to self-report, which is unreliable. There's no deterministic trigger for refreshing context.

## Solution

Two small changes to the existing loop extension:

### 1. Proactive compaction at 50% context usage

In the `agent_end` handler, check `ctx.getContextUsage().percent`. If ≥ 50%, proactively trigger `ctx.compact()` before sending the next loop prompt. This is deterministic — the agent never decides when to hand off.

50% gives plenty of headroom: the agent might use another 20–30% in its next agent loop before `agent_end` fires again, and pi's built-in auto-compaction (~92%) is still the safety net.

```typescript
pi.on("agent_end", async (event, ctx) => {
  if (!loopState.active) return;
  // ... existing abort handling ...

  const usage = ctx.getContextUsage();
  if (usage?.percent != null && usage.percent >= 50) {
    ctx.compact({
      onComplete: () => triggerLoopPrompt(ctx),
      onError: () => triggerLoopPrompt(ctx),
    });
    return;
  }

  triggerLoopPrompt(ctx);
});
```

### 2. Handoff-style custom instructions for compaction

The existing `session_before_compact` hook already calls `compact(event.preparation, ...)`, which handles conversation serialization, split turn handling, file tracking, iterative summary updates — everything. The only change is making the `customInstructions` string richer so the summary reads like a self-contained handoff briefing rather than a generic checkpoint.

```typescript
const instructions = `
This is an automated loop working toward: ${getConditionText(loopState.mode, loopState.condition)}.
Structure the summary as a self-contained handoff briefing:
- Loop goal and breakout condition
- What has been tried so far and outcomes (successes, failures, dead ends)
- Files modified or relevant
- Current state of the work
- Concrete next steps
The agent will continue from this summary with no other context about prior work.
`;
```

This replaces the current one-liner:
```typescript
// Before
`Loop active. Breakout condition: ${conditionText}. Preserve this loop state and breakout condition in the summary.`
```

## What we're NOT doing

- **No custom `generateLoopHandoff()` function.** `compact()` already serializes the conversation, calls the LLM for summarization, tracks file operations, and handles split turns. We just steer its focus via `customInstructions`.
- **No `newSession()`.** It's only available on `ExtensionCommandContext` (command handlers), not on `ExtensionContext` (event handlers like `agent_end`). And we don't need it — compaction with good instructions achieves the same "fresh context" effect.
- **No `turn_end` monitoring.** The `session_before_compact` hook fires regardless of who triggers compaction (us proactively at 50% or pi's built-in auto-compaction at ~92%), so the handoff-style summary is always used.

## Flow

```
/loop tests
  → agent works across turns
  → agent_end fires
  → context < 50%? → triggerLoopPrompt(), keep going
  → context ≥ 50%? → ctx.compact()
    → session_before_compact fires
    → compact() runs with handoff-style customInstructions
    → produces self-contained briefing with goal, attempts, state, next steps
    → onComplete → triggerLoopPrompt()
    → agent continues with compacted context that reads like a fresh handoff
```

## Key details from the compaction internals

- `compact()` calls `generateSummary()` which serializes `preparation.messagesToSummarize` (not the full conversation — only the older messages being discarded). Recent messages are kept verbatim.
- `customInstructions` are appended as `Additional focus: ...` to the summarization prompt.
- The summarization prompt already asks for structured output (Goal, Progress, Key Decisions, Next Steps). Our custom instructions steer the focus toward loop-relevant information.
- If there's a previous compaction summary, `compact()` uses an update prompt that merges old + new — so loop context accumulates correctly across multiple compactions.
- File operations (reads, writes, edits) are automatically tracked and appended as `<read-files>` and `<modified-files>` tags.
- `CompactionResult` requires `{ summary, firstKeptEntryId, tokensBefore }` — all provided by `compact()`.

## Open questions

- **Is 50% the right threshold?** Could tune this. Lower = more frequent handoffs with smaller summaries. Higher = fewer handoffs but risk of the agent using a lot of context in a single agent loop before `agent_end` fires.
- **Should we notify the user on each handoff?** The current sketch shows a `ctx.ui.notify()` call. Could also update the loop status widget to show handoff count.
