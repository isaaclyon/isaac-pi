import type { LcmStore, StoredMessage, SourceRef } from "../db/store.js";
import type { LcmConfig } from "../config.js";
import { mapConcurrent } from "../utils.js";
import {
  buildLeafPrompt,
  buildCondensedD1Prompt,
  buildCondensedD2PlusPrompt,
  serializeMessagesForPrompt,
} from "./prompts.js";
import { assembleSummary } from "./assembler.js";

const MAX_CONDENSE_PASSES = 10;

export interface CompactionDeps {
  summarize: (systemPrompt: string, signal?: AbortSignal) => Promise<string>;
  notify: (message: string, type?: string) => void;
}

export class CompactionEngine {
  private store: LcmStore;
  private config: LcmConfig;
  private locks = new Map<string, Promise<string | null>>();

  constructor(store: LcmStore, config: LcmConfig) {
    this.store = store;
    this.config = config;
  }

  async compact(
    conversationId: string,
    deps: CompactionDeps,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const prev = this.locks.get(conversationId) ?? Promise.resolve(null);
    const current = prev.then(() => this.doCompact(conversationId, deps, signal));
    this.locks.set(conversationId, current);
    try {
      return await current;
    } finally {
      if (this.locks.get(conversationId) === current) {
        this.locks.delete(conversationId);
      }
    }
  }

  private async doCompact(
    conversationId: string,
    deps: CompactionDeps,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const uncompacted = this.store.getUncompactedMessages(conversationId);

    if (uncompacted.length < this.config.minMessagesForCompaction) {
      deps.notify(`LCM: Only ${uncompacted.length} uncompacted messages, skipping DAG compaction`, "info");
      return null;
    }

    deps.notify(`LCM: Compacting ${uncompacted.length} messages into leaf summaries...`, "info");
    const leafResult = await this.leafPass(conversationId, uncompacted, deps, signal);

    if (leafResult.succeeded === 0) {
      throw new Error(`LCM leaf summarization failed for all ${leafResult.failed} chunk(s)`);
    }

    if (signal?.aborted) return null;

    await this.condensedPass(conversationId, deps, signal);

    if (signal?.aborted) return null;

    return assembleSummary(this.store, conversationId, this.config.maxSummaryTokens);
  }

  private async leafPass(
    conversationId: string,
    messages: StoredMessage[],
    deps: CompactionDeps,
    signal?: AbortSignal,
  ): Promise<{ succeeded: number; failed: number }> {
    const chunks = this.chunkMessages(messages, this.config.leafChunkTokens);

    deps.notify(`LCM: Processing ${chunks.length} chunks (concurrency ${this.config.leafPassConcurrency})...`, "info");

    const results = await mapConcurrent(
      chunks,
      this.config.leafPassConcurrency,
      async (chunk) => {
        if (signal?.aborted) throw new Error("Aborted");

        const serialized = serializeMessagesForPrompt(chunk);
        const prompt = buildLeafPrompt(serialized);

        try {
          const summaryText = await deps.summarize(prompt, signal);
          return { chunk, summaryText, failed: false };
        } catch {
          return { chunk, summaryText: "", failed: true };
        }
      },
    );

    let succeeded = 0;
    let failed = 0;

    for (const result of results) {
      if (result.status === "rejected") {
        failed++;
        continue;
      }
      const { chunk, summaryText, failed: chunkFailed } = result.value;

      if (chunkFailed || summaryText.trim().length === 0) {
        failed++;
        deps.notify(
          `LCM: Summarization failed for messages ${chunk[0].seq}-${chunk[chunk.length - 1].seq}, will retry next cycle`,
          "warning",
        );
        continue;
      }

      const sources: SourceRef[] = chunk.map((m) => ({
        source_type: "message" as const,
        source_id: m.id,
      }));

      this.store.createSummary(conversationId, 0, summaryText, sources, {
        messageRange: { from: chunk[0].seq, to: chunk[chunk.length - 1].seq },
      });

      this.store.markCompacted(chunk.map((m) => m.id));
      succeeded++;
    }

    return { succeeded, failed };
  }

  private async condensedPass(
    conversationId: string,
    deps: CompactionDeps,
    signal?: AbortSignal,
  ): Promise<void> {
    let didCondense = true;
    let passes = 0;

    while (didCondense && passes < MAX_CONDENSE_PASSES) {
      didCondense = false;
      passes++;

      for (let depth = 0; depth < this.config.maxDepth; depth++) {
        if (signal?.aborted) return;

        const unconsumed = this.store.getUnconsumedSummariesByDepth(conversationId, depth);
        if (unconsumed.length < this.config.condensationThreshold) continue;

        const toCondense = unconsumed.slice(0, this.config.condensationThreshold);

        deps.notify(
          `LCM: Condensing ${toCondense.length} D${depth} summaries into D${depth + 1}...`,
          "info",
        );

        const combinedText = toCondense.map((s) => s.text).join("\n\n---\n\n");

        const prompt =
          depth + 1 === 1
            ? buildCondensedD1Prompt(combinedText)
            : buildCondensedD2PlusPrompt(depth + 1, combinedText);

        let summaryText: string;
        try {
          summaryText = await deps.summarize(prompt, signal);
        } catch {
          deps.notify(`LCM: Condensation at D${depth + 1} failed, will retry next cycle`, "warning");
          return;
        }

        const sources: SourceRef[] = toCondense.map((s) => ({
          source_type: "summary" as const,
          source_id: s.id,
        }));

        this.store.createSummary(conversationId, depth + 1, summaryText, sources, {
          sourceSummaryIds: toCondense.map((s) => s.id),
        });

        didCondense = true;
      }
    }

    if (passes >= MAX_CONDENSE_PASSES) {
      deps.notify("LCM: Condensation hit pass limit, will continue next cycle", "warning");
    }
  }

  private chunkMessages(messages: StoredMessage[], tokenBudget: number): StoredMessage[][] {
    const chunks: StoredMessage[][] = [];
    let current: StoredMessage[] = [];
    let tokens = 0;

    for (const msg of messages) {
      const msgTokens = msg.token_estimate;
      if (tokens + msgTokens > tokenBudget && current.length > 0) {
        chunks.push(current);
        current = [];
        tokens = 0;
      }
      current.push(msg);
      tokens += msgTokens;
    }

    if (current.length > 0) chunks.push(current);
    return chunks;
  }
}
