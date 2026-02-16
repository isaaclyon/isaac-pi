#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const scipExtensionDir = path.join(packageRoot, ".pi", "extensions", "pi-agent-scip");
const sourcePiDir = path.join(packageRoot, ".pi");

function log(message) {
  console.log(`[isaac-pi] ${message}`);
}

function installScipDependencies() {
  const scipPackageJson = path.join(scipExtensionDir, "package.json");
  if (!fs.existsSync(scipPackageJson)) {
    log("Skipping SCIP dependency install (.pi/extensions/pi-agent-scip not found).");
    return;
  }

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = spawnSync(npmCommand, ["install", "--omit=dev"], {
    cwd: scipExtensionDir,
    stdio: "inherit",
    env: process.env,
  });

  if (result.error) {
    throw result.error;
  }
  if (typeof result.status === "number" && result.status !== 0) {
    throw new Error(`SCIP dependency install failed with exit code ${result.status}.`);
  }
}

function resolveInstallRoot() {
  const initCwd = process.env.INIT_CWD;
  const localPrefix = process.env.npm_config_local_prefix;
  const globalInstall = process.env.npm_config_global === "true";

  if (globalInstall) {
    return null;
  }

  const candidate = initCwd || localPrefix;
  if (!candidate) {
    return null;
  }

  return path.resolve(candidate);
}

function listRelativeFiles(dir, include) {
  const files = [];
  const stack = [""];

  while (stack.length > 0) {
    const relativeDir = stack.pop();
    const absoluteDir = path.join(dir, relativeDir);

    let entries;
    try {
      entries = fs.readdirSync(absoluteDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const relativePath = path.join(relativeDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(relativePath);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }
      if (include(relativePath)) {
        files.push(relativePath);
      }
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function syncFiles({ sourceDir, targetDir, include, label }) {
  if (!fs.existsSync(sourceDir)) {
    log(`Skipping ${label} sync (${path.relative(packageRoot, sourceDir)} not found in package).`);
    return;
  }

  const files = listRelativeFiles(sourceDir, include);
  if (files.length === 0) {
    log(`Skipping ${label} sync (no matching files found).`);
    return;
  }

  let copied = 0;
  let skipped = 0;

  for (const relativeFile of files) {
    const sourcePath = path.join(sourceDir, relativeFile);
    const targetPath = path.join(targetDir, relativeFile);

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });

    if (fs.existsSync(targetPath)) {
      skipped += 1;
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    copied += 1;
  }

  if (copied > 0) {
    log(`Synced ${copied} ${label} file(s) to ${targetDir}.`);
  }
  if (skipped > 0) {
    log(`Kept ${skipped} existing ${label} file(s) unchanged in ${targetDir}.`);
  }
}

function syncRepoResources() {
  const installRoot = resolveInstallRoot();
  if (!installRoot) {
    log("Skipping repo resource sync (could not determine install target root).");
    return;
  }

  if (installRoot === packageRoot) {
    log("Skipping repo resource sync (installing inside package repo).");
    return;
  }

  const targetPiDir = path.join(installRoot, ".pi");

  syncFiles({
    sourceDir: path.join(sourcePiDir, "agents"),
    targetDir: path.join(targetPiDir, "agents"),
    include: (relativePath) => relativePath.endsWith(".md"),
    label: "agent",
  });

  syncFiles({
    sourceDir: path.join(sourcePiDir, "prompts"),
    targetDir: path.join(targetPiDir, "prompts"),
    include: (relativePath) => relativePath.endsWith(".md"),
    label: "prompt",
  });

  syncFiles({
    sourceDir: path.join(sourcePiDir, "hooks"),
    targetDir: path.join(targetPiDir, "hooks"),
    include: () => true,
    label: "hook",
  });
}

function main() {
  installScipDependencies();
  syncRepoResources();
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[isaac-pi] postinstall failed: ${message}`);
  process.exit(1);
}
