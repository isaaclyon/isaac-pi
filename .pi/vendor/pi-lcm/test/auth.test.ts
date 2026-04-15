import { describe, expect, it, vi } from "vitest";

import { resolveRequestAuth } from "../src/auth";

describe("resolveRequestAuth", () => {
  it("treats successful auth without an apiKey as an unavailable credential without noisy errors", async () => {
    const logger = { error: vi.fn() };
    const modelRegistry = {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({ ok: true, apiKey: undefined, headers: undefined }),
    };

    const auth = await resolveRequestAuth(modelRegistry, { provider: "cerebras", id: "zai-glm-4.7" }, logger, "compaction");

    expect(auth).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("returns apiKey and headers when available", async () => {
    const logger = { error: vi.fn() };
    const modelRegistry = {
      getApiKeyAndHeaders: vi.fn().mockResolvedValue({
        ok: true,
        apiKey: "secret",
        headers: { Authorization: "Bearer secret" },
      }),
    };

    const auth = await resolveRequestAuth(modelRegistry, { provider: "cerebras", id: "zai-glm-4.7" }, logger, "compaction");

    expect(auth).toEqual({
      apiKey: "secret",
      headers: { Authorization: "Bearer secret" },
    });
    expect(logger.error).not.toHaveBeenCalled();
  });
});
