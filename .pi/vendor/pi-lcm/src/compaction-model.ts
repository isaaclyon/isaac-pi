import { complete } from "@mariozechner/pi-ai";

import type { LcmConfig } from "./config.js";
import { resolveRequestAuth } from "./auth.js";

interface LoggerLike {
  info(message: string): void;
  warn(message: string): void;
  error?(message: string): void;
}

interface CompactionModelDeps {
  completeImpl?: typeof complete;
  resolveAuth?: typeof resolveRequestAuth;
  notify?: (message: string, type?: string) => void;
  logger?: LoggerLike;
}

function modelKey(model: { provider: string; id: string }): string {
  return `${model.provider}/${model.id}`;
}

function debugNotify(config: LcmConfig, notify: ((message: string, type?: string) => void) | undefined, message: string, type: string): void {
  if (!config.debugMode || !notify) return;
  notify(message, type);
}

export async function callCompactionModel(
  ctx: any,
  config: LcmConfig,
  prompt: string,
  signal?: AbortSignal,
  deps: CompactionModelDeps = {},
): Promise<string> {
  const completeImpl = deps.completeImpl ?? complete;
  const resolveAuth = deps.resolveAuth ?? resolveRequestAuth;
  const notify = deps.notify;
  const logger = deps.logger ?? console;

  for (const cfg of config.compactionModels) {
    const model = ctx.modelRegistry.find?.(cfg.provider, cfg.id)
      ?? ctx.modelRegistry.getAll().find((m: any) => m.provider === cfg.provider && m.id === cfg.id);
    if (!model) continue;

    const key = modelKey(model);
    logger.info(`[LCM] Attempting compaction with ${key}`);
    debugNotify(config, notify, `LCM: trying compaction model ${key}`, "info");

    const auth = await resolveAuth(ctx.modelRegistry, model, logger, `compaction model ${key}`);
    if (!auth) {
      logger.warn(`[LCM] No auth available for compaction model ${key}`);
      continue;
    }

    try {
      const response = await completeImpl(
        model,
        {
          systemPrompt: "You are a precise conversation summarizer. Output only the summary, nothing else.",
          messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }], timestamp: Date.now() }],
        },
        { apiKey: auth.apiKey, headers: auth.headers, signal },
      );

      const text = response.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      if (text.length > 0) {
        logger.info(`[LCM] Compaction succeeded with ${key}`);
        debugNotify(config, notify, `LCM: used compaction model ${key}`, "success");
        return text;
      }

      logger.warn(`[LCM] Compaction model ${key} returned no text`);
    } catch (e: any) {
      if (signal?.aborted) throw e;
      logger.warn(`[LCM] Compaction model ${key} failed: ${e.message}`);
    }
  }

  if (ctx.model) {
    const fallbackKey = modelKey(ctx.model);
    logger.info(`[LCM] Attempting compaction fallback with ${fallbackKey}`);
    debugNotify(config, notify, `LCM: falling back to ${fallbackKey}`, "warning");

    const fallbackAuth = await resolveAuth(ctx.modelRegistry, ctx.model, logger, `fallback model ${fallbackKey}`);
    if (fallbackAuth) {
      const response = await completeImpl(
        ctx.model,
        {
          systemPrompt: "You are a precise conversation summarizer. Output only the summary, nothing else.",
          messages: [{ role: "user" as const, content: [{ type: "text" as const, text: prompt }], timestamp: Date.now() }],
        },
        { apiKey: fallbackAuth.apiKey, headers: fallbackAuth.headers, signal },
      );
      const text = response.content.filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
      if (text.length > 0) {
        logger.info(`[LCM] Compaction succeeded with fallback ${fallbackKey}`);
        debugNotify(config, notify, `LCM: used fallback compaction model ${fallbackKey}`, "success");
        return text;
      }

      logger.warn(`[LCM] Fallback compaction model ${fallbackKey} returned no text`);
    } else {
      logger.warn(`[LCM] No auth available for fallback compaction model ${fallbackKey}`);
    }
  }

  throw new Error("No model available for compaction summarization");
}
