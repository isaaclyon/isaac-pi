import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const agentDir = resolve(here, "..");
const npmRoot = join(agentDir, "npm");
const nodeModules = join(npmRoot, "node_modules");
const lockDir = join(agentDir, "state", "native-module-abi-guard.lock");
const rebuildTimeoutMs = 45_000;
const lockWaitTimeoutMs = 10_000;

const probes = [
  {
    name: "better-sqlite3",
    packageName: "better-sqlite3",
    modulePath: join(nodeModules, "better-sqlite3"),
    rebuild: { cwd: npmRoot, args: ["rebuild", "better-sqlite3"] },
    smoke: smokeBetterSqlite3,
  },
  {
    name: "pi-lcm/better-sqlite3",
    packageName: "better-sqlite3",
    modulePath: join(nodeModules, "pi-lcm", "node_modules", "better-sqlite3"),
    rebuild: { cwd: join(nodeModules, "pi-lcm", "node_modules", "better-sqlite3"), args: ["rebuild"] },
    smoke: smokeBetterSqlite3,
    optional: true,
  },
  {
    name: "sqlite-vec",
    packageName: "sqlite-vec",
    modulePath: join(nodeModules, "sqlite-vec"),
    rebuild: { cwd: npmRoot, args: ["rebuild", "sqlite-vec"] },
    smoke: smokeSqliteVec,
    optional: true,
  },
];

export default async function nativeModuleAbiGuard() {
  const failures = probeFailures();
  if (failures.length === 0) return;

  console.error(`[native-module-abi-guard] Rebuilding Pi native modules for ${process.version}: ${failures.map((f) => f.name).join(", ")}`);
  rebuildWithCurrentNode(failures);

  const remaining = probeFailures();
  if (remaining.length > 0) {
    const details = remaining.map((f) => `${f.name}: ${f.message}`).join("; ");
    throw new Error(`Native module rebuild did not fix ABI mismatch: ${details}`);
  }
}

function probeFailures() {
  const failures = [];
  for (const probe of probes) {
    if (probe.optional && !existsSync(probe.modulePath)) continue;
    try {
      probe.smoke(probe.modulePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (isNativeAbiFailure(message)) failures.push({ name: probe.name, rebuild: probe.rebuild, message });
      else throw error;
    }
  }
  return failures;
}

function smokeBetterSqlite3(modulePath) {
  const Database = require(modulePath);
  const db = new Database(":memory:");
  db.prepare("SELECT 1").get();
  db.close();
}

function smokeRequireOnly(modulePath) {
  require(modulePath);
}

function smokeSqliteVec(modulePath) {
  const sqliteVec = require(modulePath);
  const Database = require(join(nodeModules, "better-sqlite3"));
  const db = new Database(":memory:");
  try {
    sqliteVec.load(db);
    db.prepare("SELECT vec_version()").get();
  } finally {
    db.close();
  }
}

function isNativeAbiFailure(message) {
  return /NODE_MODULE_VERSION|compiled against a different Node\.js version|ERR_DLOPEN_FAILED|Module did not self-register|not a Mach-O|invalid ELF|dlopen|Cannot find module .*\.node|Could not locate the bindings file/.test(message);
}

function rebuildWithCurrentNode(failures) {
  withLock(() => {
    for (const failure of failures) {
      runNpm(failure.rebuild.args, failure.rebuild.cwd);
    }
  });
}

function runNpm(npmArgs, cwd) {
  const npmCli = join(dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  const command = existsSync(npmCli) ? process.execPath : "npm";
  const args = existsSync(npmCli) ? [npmCli, ...npmArgs] : npmArgs;
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: rebuildTimeoutMs,
    env: {
      ...process.env,
      PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ""}`,
    },
  });

  if (result.error) {
    throw new Error(`npm ${npmArgs.join(" ")} failed: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(`npm ${npmArgs.join(" ")} failed with exit ${result.status ?? "signal " + result.signal}: ${output}`);
  }
}

function withLock(fn) {
  const start = Date.now();
  while (true) {
    try {
      mkdirSync(lockDir, { recursive: false });
      writeFileSync(join(lockDir, "pid"), String(process.pid));
      break;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (isStaleLock()) {
        rmSync(lockDir, { recursive: true, force: true });
        continue;
      }
      if (Date.now() - start > lockWaitTimeoutMs) {
        throw new Error(`Timed out waiting for native module rebuild lock: ${lockDir}`);
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
  }

  try {
    fn();
  } finally {
    rmSync(lockDir, { recursive: true, force: true });
  }
}

function isAlreadyExists(error) {
  return error && typeof error === "object" && "code" in error && error.code === "EEXIST";
}

function isStaleLock() {
  try {
    const pid = Number(readFileSync(join(lockDir, "pid"), "utf8"));
    if (Number.isInteger(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return false;
      } catch {
        return true;
      }
    }
  } catch {
    // Old guard versions did not write a pid file. Fall through to mtime check.
  }

  try {
    return Date.now() - statSync(lockDir).mtimeMs > 10_000;
  } catch {
    return true;
  }
}
