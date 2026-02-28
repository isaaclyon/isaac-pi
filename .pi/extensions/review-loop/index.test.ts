import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

type EventHandler = (event: any, ctx: any) => Promise<any> | any;
type CommandConfig = {
  description: string;
  handler: (args: string, ctx: any) => Promise<void> | void;
};

describe("review-loop unified command", () => {
  let commands: Record<string, CommandConfig>;
  let notify: ReturnType<typeof vi.fn>;
  let setStatus: ReturnType<typeof vi.fn>;
  let sendUserMessage: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    vi.doMock("./settings", () => ({
      loadSettings: () => ({
        maxIterations: 7,
        reviewPromptConfig: { type: "inline", value: "default" },
        autoTrigger: false,
        freshContext: false,
        triggerPatterns: [/implement/i],
        exitPatterns: [/no issues found/i],
        issuesFixedPatterns: [/fixed/i],
      }),
      getReviewPrompt: (config: { type: string; value: string }) =>
        config.type === "template" ? `prompt:${config.value}` : "prompt:default",
    }));

    commands = {};
    notify = vi.fn();
    setStatus = vi.fn();
    sendUserMessage = vi.fn();

    const handlers: Record<string, EventHandler> = {};

    const pi = {
      on: vi.fn((event: string, handler: EventHandler) => {
        handlers[event] = handler;
      }),
      registerCommand: vi.fn((name: string, command: CommandConfig) => {
        commands[name] = command;
      }),
      registerTool: vi.fn(),
      sendUserMessage,
    } as unknown as ExtensionAPI;

    const { default: reviewLoopExtension } = await import("./index");
    reviewLoopExtension(pi);
  });

  it("registers canonical /review-loop command and legacy aliases", () => {
    expect(commands["review-loop"]).toBeDefined();

    expect(commands["review-start"]).toBeDefined();
    expect(commands["review-plan"]).toBeDefined();
    expect(commands["review-max"]).toBeDefined();
    expect(commands["review-exit"]).toBeDefined();
    expect(commands["review-status"]).toBeDefined();
    expect(commands["review-auto"]).toBeDefined();
    expect(commands["review-fresh"]).toBeDefined();
  });

  it("shows help output from /review-loop help", async () => {
    const ctx = { hasUI: true, ui: { notify, setStatus } };

    await commands["review-loop"]!.handler("help", ctx);

    expect(notify).toHaveBeenCalledWith(expect.stringContaining("/review-loop plan"), "info");
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("/review-loop (starts review)"),
      "info"
    );
  });

  it("supports /review-loop plan and sends plan prompt", async () => {
    const ctx = { hasUI: true, ui: { notify, setStatus } };

    await commands["review-loop"]!.handler("plan", ctx);

    expect(sendUserMessage).toHaveBeenCalledWith("prompt:double-check-plan");
  });

  it("keeps legacy alias with deprecation guidance", async () => {
    const ctx = { hasUI: true, ui: { notify, setStatus } };

    await commands["review-status"]!.handler("", ctx);

    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("/review-status is deprecated"),
      "warning"
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("Use /review-loop status"),
      "warning"
    );
  });
});
