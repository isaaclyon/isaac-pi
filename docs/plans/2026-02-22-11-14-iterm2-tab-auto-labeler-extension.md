---
title: "iTerm2 Tab Auto-Labeler Extension"
status: approved
decision: keep_context
approvedAt: 2026-02-22T17:14:05.073Z
sessionId: 2026-02-22T17-05-08-818Z_47f0e097-c7d6-40d8-982e-cb7dbed560d0
sessionFile: "/Users/isaaclyon/.pi/agent/sessions/--Users-isaaclyon-Developer-personal-pi--/2026-02-22T17-05-08-818Z_47f0e097-c7d6-40d8-982e-cb7dbed560d0.jsonl"
---

# iTerm2 Tab Auto-Labeler Extension

## Goal

Create a pi extension that automatically renames the iTerm2 tab based on the conversation topic, updating every 5th user message by sending recent context to `gpt-5.3-codex` (no reasoning) to produce a ≤6-word label.

## Context

**Feasibility: Very High** — every required piece already exists in the pi extension API:

| Need | API | Example |
|------|-----|---------|
| Set iTerm2 tab name | `ctx.ui.setTitle(label)` | `titlebar-spinner.ts` |
| Count user messages | `pi.on("agent_end", ...)` | Event lifecycle |
| Call a cheap LLM | `complete()` from `@mariozechner/pi-ai` | `summarize.ts`, `qna.ts` |
| Get conversation context | `ctx.sessionManager.getBranch()` | `summarize.ts` |
| Persist the label | `pi.setSessionName(label)` | `session-name.ts` |

The `setTitle()` call emits an ANSI escape sequence (`\x1b]0;...\x07`) which iTerm2 uses for tab names. The `titlebar-spinner.ts` example already proves this works.

## Steps

### 1. Create `.pi/extensions/tab-labeler.ts`

Single-file extension, auto-discovered via the existing `".pi/extensions"` entry in `package.json`.

```typescript
import { complete, getModel } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
```

### 2. Track user message count via `agent_end`

Increment a counter on each `agent_end`. Trigger labeling on the 1st exchange and every 5th thereafter.

```typescript
let messageCount = 0;
const LABEL_EVERY = 5;

pi.on("agent_end", async (event, ctx) => {
  messageCount++;
  if (messageCount === 1 || messageCount % LABEL_EVERY === 0) {
    generateAndSetLabel(ctx); // fire-and-forget, don't await
  }
});
```

Using `agent_end` rather than `input` because it fires after the agent has responded — more context available for a better label.

### 3. Build minimal context for the labeling prompt

Extract the last ~5 user+assistant text pairs from `ctx.sessionManager.getBranch()`. Keep it compact — just enough for the model to understand the topic. Strip tool calls and results to minimize tokens.

### 4. Call `gpt-5.3-codex` with no reasoning

```typescript
const model = ctx.modelRegistry.find("openai", "gpt-5.3-codex");
const apiKey = await ctx.modelRegistry.getApiKey(model);

const response = await complete(
  model,
  {
    messages: [{
      role: "user",
      content: [{ type: "text", text: prompt }],
      timestamp: Date.now(),
    }],
  },
  { apiKey }
);
```

The prompt will be something like:

> "Based on this conversation, produce a 6-word-or-less label describing the task. Output ONLY the label — no quotes, no punctuation, no explanation.
>
> \<conversation\>...\</conversation\>"

No `reasoningEffort` param needed since `gpt-5.3-codex` is a non-reasoning model.

### 5. Set the tab title and session name

```typescript
const label = extractText(response).trim();
if (label) {
  ctx.ui.setTitle(`π ${label}`);
  pi.setSessionName(label);
}
```

Both the iTerm2 tab and the `/resume` session selector show the label.

### 6. Handle session restore

On `session_start`, restore the title from any existing session name, and count existing user messages in the branch to resume the counter correctly:

```typescript
pi.on("session_start", async (_event, ctx) => {
  const existing = pi.getSessionName();
  if (existing) ctx.ui.setTitle(`π ${existing}`);

  // Resume message count from branch
  messageCount = ctx.sessionManager.getBranch()
    .filter(e => e.type === "message" && e.message?.role === "user")
    .length;
});
```

### 7. Graceful fallback

If `gpt-5.3-codex` isn't found or has no API key, log a one-time notification and silently no-op. Don't block or break anything.

### 8. Debounce / cancel in-flight

Track an `AbortController` for the current labeling call. If a new one triggers before the previous finishes, abort the old one. Prevents race conditions from fast message sequences.

## File Summary

| File | Action |
|------|--------|
| `.pi/extensions/tab-labeler.ts` | **Create** — the full extension (~80-100 lines) |
| `package.json` | **No changes** — already discovers `.pi/extensions/` |

## Risks

1. **Model availability** — `gpt-5.3-codex` must be registered in the model registry and have an API key configured. Mitigation: silent fallback with a one-time warning notification.
2. **Terminal compatibility** — `setTitle()` works perfectly in iTerm2 but may be ignored in other terminals. Purely cosmetic, no harm.
3. **Label quality** — a 6-word label from minimal context might be vague early on. First-message labeling helps, and it improves as context grows.
4. **Cost** — trivial. A ~200 token prompt to a codex-class model every 5 messages costs essentially nothing.
5. **Race condition** — fast message sequences could overlap calls. Mitigated by AbortController cancellation in step 8.
