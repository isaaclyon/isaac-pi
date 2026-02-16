#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const packageRoot = path.resolve(__dirname, "..");
const sourceAgentsDir = path.join(packageRoot, ".pi", "agents");
const scipExtensionDir = path.join(packageRoot, ".pi", "extensions", "pi-agent-scip");

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

function copyAgentsIntoTargetRepo() {
  if (!fs.existsSync(sourceAgentsDir)) {
    log("Skipping agent sync (.pi/agents not found in package).");
    return;
  }

  const installRoot = resolveInstallRoot();
  if (!installRoot) {
    log("Skipping agent sync (could not determine install target root).");
    return;
  }

  if (installRoot === packageRoot) {
    log("Skipping agent sync (installing inside package repo).");
    return;
  }

  const targetAgentsDir = path.join(installRoot, ".pi", "agents");
  fs.mkdirSync(targetAgentsDir, { recursive: true });

  const entries = fs.readdirSync(sourceAgentsDir, { withFileTypes: true });
  const markdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  if (markdownFiles.length === 0) {
    log("Skipping agent sync (no .md agent files found).");
    return;
  }

  let copied = 0;
  let skipped = 0;

  for (const fileName of markdownFiles) {
    const sourcePath = path.join(sourceAgentsDir, fileName);
    const targetPath = path.join(targetAgentsDir, fileName);

    if (fs.existsSync(targetPath)) {
      skipped += 1;
      continue;
    }

    fs.copyFileSync(sourcePath, targetPath);
    copied += 1;
  }

  if (copied > 0) {
    log(`Synced ${copied} agent file(s) to ${targetAgentsDir}.`);
  }
  if (skipped > 0) {
    log(`Kept ${skipped} existing agent file(s) unchanged in ${targetAgentsDir}.`);
  }
  if (copied === 0 && skipped === 0) {
    log("No agent files were copied.");
  }
}

function main() {
  installScipDependencies();
  copyAgentsIntoTargetRepo();
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[isaac-pi] postinstall failed: ${message}`);
  process.exit(1);
}
