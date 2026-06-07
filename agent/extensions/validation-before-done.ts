import { type ExtensionAPI, isBashToolResult, isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import { resolve } from "node:path";

interface PromptState {
  changedPaths: Set<string>;
  validationCommands: string[];
}

function createPromptState(): PromptState {
  return {
    changedPaths: new Set<string>(),
    validationCommands: [],
  };
}

function isValidationCommand(command: string): boolean {
  return /(\b(test|vitest|jest|mocha|ava|tap|cypress|playwright|lint|eslint|biome|typecheck|tsc|pyright|mypy|ruff)\b)|(\bgo test\b)|(\bcargo test\b)/i.test(
    command,
  );
}

let state = createPromptState();

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => ({
    systemPrompt:
      event.systemPrompt +
      "\n\nQuality rule: if you modify code, run at least one targeted validation command before finishing (test, lint, or typecheck) and mention what you ran.",
  }));

  pi.on("agent_start", async () => {
    state = createPromptState();
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!event.isError && (isEditToolResult(event) || isWriteToolResult(event))) {
      const path = event.input.path;
      if (typeof path === "string") {
        state.changedPaths.add(resolve(ctx.cwd, path));
      }
      return;
    }

    if (!event.isError && isBashToolResult(event)) {
      const command = event.input.command;
      if (typeof command === "string" && isValidationCommand(command)) {
        state.validationCommands.push(command);
      }
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (state.changedPaths.size === 0 || state.validationCommands.length > 0 || !ctx.hasUI) {
      return;
    }

    ctx.ui.notify(
      `Changed ${state.changedPaths.size} file(s) without running a test, lint, or typecheck command.`,
      "warning",
    );
  });
}
