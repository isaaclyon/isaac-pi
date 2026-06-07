import { type ExtensionAPI, isEditToolResult, isWriteToolResult } from "@earendil-works/pi-coding-agent";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const FORMATTABLE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".css",
  ".scss",
  ".md",
]);

function isFormattablePath(path: string): boolean {
  return [...FORMATTABLE_EXTENSIONS].some((ext) => path.endsWith(ext));
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

function formatterCommand(cwd: string, path: string): { command: string; args: string[] } | undefined {
  const pm = detectPackageManager(cwd);
  const command = pm === "pnpm" ? "pnpm" : pm === "bun" ? "bunx" : pm === "yarn" ? "yarn" : "npx";
  const prefixArgs = pm === "pnpm" ? ["exec"] : [];

  if (hasAny(cwd, ["biome.json", "biome.jsonc"])) {
    return {
      command,
      args: [...prefixArgs, "biome", "format", "--write", path],
    };
  }

  if (
    hasAny(cwd, [
      ".prettierrc",
      ".prettierrc.json",
      ".prettierrc.js",
      "prettier.config.js",
      "prettier.config.mjs",
    ])
  ) {
    return {
      command,
      args: [...prefixArgs, "prettier", "--write", path],
    };
  }

  return undefined;
}

let formattedThisTurn = new Set<string>();

export default function (pi: ExtensionAPI) {
  pi.on("agent_start", async () => {
    formattedThisTurn = new Set<string>();
  });

  pi.on("tool_result", async (event, ctx) => {
    if (event.isError || (!isEditToolResult(event) && !isWriteToolResult(event))) {
      return;
    }

    const inputPath = event.input.path;
    if (typeof inputPath !== "string") {
      return;
    }

    const resolvedPath = resolve(ctx.cwd, inputPath);
    if (!isFormattablePath(resolvedPath) || formattedThisTurn.has(resolvedPath)) {
      return;
    }

    const format = formatterCommand(ctx.cwd, resolvedPath);
    if (!format) {
      return;
    }

    formattedThisTurn.add(resolvedPath);

    const result = await pi.exec(format.command, format.args, {
      cwd: ctx.cwd,
      timeout: 15_000,
      signal: ctx.signal,
    });

    if (result.code !== 0 && ctx.hasUI) {
      ctx.ui.notify(`Auto-format failed for ${inputPath}: ${result.stderr || `exit ${result.code}`}`, "warning");
    }
  });
}
