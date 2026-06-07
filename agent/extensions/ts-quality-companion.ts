import { type ExtensionAPI, isBashToolResult, isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { relative, resolve } from "node:path";

interface PromptState {
  touchedTsFiles: Set<string>;
  sawTypecheck: boolean;
  sawLint: boolean;
  sawFormat: boolean;
}

function createPromptState(): PromptState {
  return {
    touchedTsFiles: new Set<string>(),
    sawTypecheck: false,
    sawLint: false,
    sawFormat: false,
  };
}

function isTypeScriptPath(path: string): boolean {
  return /\.(ts|tsx|mts|cts)$/.test(path);
}

function detectPackageManager(cwd: string): "pnpm" | "yarn" | "bun" | "npm" {
  if (existsSync(resolve(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(resolve(cwd, "yarn.lock"))) return "yarn";
  if (existsSync(resolve(cwd, "bun.lockb")) || existsSync(resolve(cwd, "bun.lock"))) return "bun";
  return "npm";
}

function hasAny(cwd: string, names: string[]): boolean {
  return names.some((name) => existsSync(resolve(cwd, name)));
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildSuggestions(cwd: string, files: string[]): string[] {
  const pm = detectPackageManager(cwd);
  const execPrefix = pm === "pnpm" ? "pnpm exec" : pm === "bun" ? "bunx" : pm === "yarn" ? "yarn" : "npx";
  const fileArgs = files.slice(0, 4).map(shellQuote).join(" ");
  const suggestions = [`${execPrefix} tsc --noEmit`];

  if (hasAny(cwd, ["biome.json", "biome.jsonc"])) {
    suggestions.push(`${execPrefix} biome check ${fileArgs}`.trim());
    suggestions.push(`${execPrefix} biome format --check ${fileArgs}`.trim());
    return suggestions;
  }

  if (hasAny(cwd, ["eslint.config.js", "eslint.config.mjs", "eslint.config.cjs", ".eslintrc", ".eslintrc.json", ".eslintrc.js", ".eslintrc.cjs"])) {
    suggestions.push(`${execPrefix} eslint ${fileArgs}`.trim());
  }

  if (hasAny(cwd, [".prettierrc", ".prettierrc.json", ".prettierrc.js", "prettier.config.js", "prettier.config.mjs"])) {
    suggestions.push(`${execPrefix} prettier --check ${fileArgs}`.trim());
  }

  return suggestions;
}

function recordValidation(command: string, state: PromptState): void {
  if (/\b(tsc|typecheck)\b/i.test(command)) {
    state.sawTypecheck = true;
  }
  if (/\b(eslint|biome check|biome lint|lint)\b/i.test(command)) {
    state.sawLint = true;
  }
  if (/\b(prettier|biome format|format)\b/i.test(command)) {
    state.sawFormat = true;
  }
}

let state = createPromptState();

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", async () => {
    state = createPromptState();
  });

  pi.on("tool_result", async (event, ctx) => {
    if (!event.isError && (isEditToolResult(event) || isWriteToolResult(event))) {
      const path = event.input.path;
      if (typeof path === "string") {
        const resolvedPath = resolve(ctx.cwd, path);
        if (isTypeScriptPath(resolvedPath)) {
          state.touchedTsFiles.add(resolvedPath);
        }
      }
      return;
    }

    if (!event.isError && isBashToolResult(event)) {
      const command = event.input.command;
      if (typeof command === "string") {
        recordValidation(command, state);
      }
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (state.touchedTsFiles.size === 0 || !ctx.hasUI) {
      return;
    }

    const missing: string[] = [];
    if (!state.sawTypecheck) missing.push("typecheck");
    if (!state.sawLint) missing.push("lint");
    if (!state.sawFormat) missing.push("format check");

    if (missing.length === 0) {
      return;
    }

    const files = [...state.touchedTsFiles].map((path) => relative(ctx.cwd, path));
    const suggestions = buildSuggestions(ctx.cwd, files).slice(0, 3).join(" • ");

    ctx.ui.notify(
      `Touched TS without ${missing.join(", ")}. Suggested: ${suggestions}`,
      "warning",
    );
  });
}
