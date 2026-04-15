import { describe, expect, it, vi } from "vitest";

import { callCompactionModel } from "../src/compaction-model";

function createBaseCtx() {
  const primaryModel = { provider: "cerebras", id: "gpt-oss-120b" };
  return {
    modelRegistry: {
      find: vi.fn().mockReturnValue(primaryModel),
      getAll: vi.fn().mockReturnValue([primaryModel]),
    },
    model: { provider: "openai-codex", id: "gpt-5.4" },
  };
}

describe("callCompactionModel", () => {
  it("logs the selected primary compaction model when it succeeds", async () => {
    const ctx = createBaseCtx();
    const notify = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const completeImpl = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "summary text" }],
    });
    const resolveAuth = vi.fn().mockResolvedValue({ apiKey: "secret", headers: undefined });

    const text = await callCompactionModel(
      ctx,
      {
        debugMode: true,
        compactionModels: [{ provider: "cerebras", id: "gpt-oss-120b" }],
      } as any,
      "prompt",
      undefined,
      { completeImpl, resolveAuth, notify, logger },
    );

    expect(text).toBe("summary text");
    expect(logger.info).toHaveBeenCalledWith("[LCM] Attempting compaction with cerebras/gpt-oss-120b");
    expect(logger.info).toHaveBeenCalledWith("[LCM] Compaction succeeded with cerebras/gpt-oss-120b");
    expect(notify).toHaveBeenCalledWith("LCM: trying compaction model cerebras/gpt-oss-120b", "info");
    expect(notify).toHaveBeenCalledWith("LCM: used compaction model cerebras/gpt-oss-120b", "success");
  });

  it("logs when it falls back to ctx.model after configured models fail", async () => {
    const ctx = {
      modelRegistry: {
        find: vi.fn()
          .mockImplementation((provider: string, id: string) => {
            if (provider === "cerebras" && id === "gpt-oss-120b") return { provider, id };
            return undefined;
          }),
        getAll: vi.fn().mockReturnValue([{ provider: "cerebras", id: "gpt-oss-120b" }]),
      },
      model: { provider: "openai-codex", id: "gpt-5.4" },
    };
    const notify = vi.fn();
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const completeImpl = vi.fn()
      .mockRejectedValueOnce(new Error("primary failed"))
      .mockResolvedValueOnce({ content: [{ type: "text", text: "fallback summary" }] });
    const resolveAuth = vi.fn()
      .mockResolvedValueOnce({ apiKey: "primary", headers: undefined })
      .mockResolvedValueOnce({ apiKey: "fallback", headers: undefined });

    const text = await callCompactionModel(
      ctx,
      {
        debugMode: true,
        compactionModels: [{ provider: "cerebras", id: "gpt-oss-120b" }],
      } as any,
      "prompt",
      undefined,
      { completeImpl, resolveAuth, notify, logger },
    );

    expect(text).toBe("fallback summary");
    expect(logger.warn).toHaveBeenCalledWith("[LCM] Compaction model cerebras/gpt-oss-120b failed: primary failed");
    expect(logger.info).toHaveBeenCalledWith("[LCM] Attempting compaction fallback with openai-codex/gpt-5.4");
    expect(logger.info).toHaveBeenCalledWith("[LCM] Compaction succeeded with fallback openai-codex/gpt-5.4");
    expect(notify).toHaveBeenCalledWith("LCM: falling back to openai-codex/gpt-5.4", "warning");
    expect(notify).toHaveBeenCalledWith("LCM: used fallback compaction model openai-codex/gpt-5.4", "success");
  });
});
