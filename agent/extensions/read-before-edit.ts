import { isToolCallEventType, type ExtensionAPI, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function collectSuccessfulReadPaths(entries: SessionEntry[], cwd: string): Set<string> {
  const readCalls = new Map<string, string>();
  const readPaths = new Set<string>();

  for (const entry of entries) {
    if (entry.type !== "message") continue;
    const message = entry.message;

    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type !== "toolCall" || part.name !== "read") continue;
        const path = part.arguments?.path;
        if (typeof path !== "string") continue;
        readCalls.set(part.id, resolve(cwd, path));
      }
      continue;
    }

    if (message.role !== "toolResult") continue;
    if (message.toolName !== "read" || message.isError) continue;

    const resolvedPath = readCalls.get(message.toolCallId);
    if (resolvedPath) {
      readPaths.add(resolvedPath);
    }
  }

  return readPaths;
}

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (!isToolCallEventType("edit", event) && !isToolCallEventType("write", event)) {
      return;
    }

    const resolvedPath = resolve(ctx.cwd, event.input.path);
    const fileExists = existsSync(resolvedPath);

    if (!fileExists && isToolCallEventType("write", event)) {
      return;
    }

    const readPaths = collectSuccessfulReadPaths(ctx.sessionManager.getBranch(), ctx.cwd);
    if (readPaths.has(resolvedPath)) {
      return;
    }

    return {
      block: true,
      reason: `Read ${event.input.path} successfully before modifying it`,
    };
  });
}
