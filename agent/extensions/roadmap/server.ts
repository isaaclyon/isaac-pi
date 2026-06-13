/**
 * Server lifecycle for the roadmap extension (the effectful layer).
 *
 * Exactly one read-only UI server runs per project root, shared across concurrent
 * sessions via a refcounted `<root>/.pi/roadmap/.server.json`, on a free port, and
 * shut down when the last attached session detaches. A short-lived `O_EXCL` mutex
 * serialises sessions racing to spawn; dead pids and unanswered ports self-heal on
 * the next start. All policy decisions live in core.ts — this module only performs
 * the I/O (fs, child_process, http, net) those decisions imply.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
	existsSync,
	mkdirSync,
	openSync,
	closeSync,
	readdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { request } from "node:http";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
	attachRef,
	type BoardSnapshot,
	detachRef,
	lockPath,
	parseServerState,
	pickFreePort,
	roadmapDir,
	type ServerState,
	serverStatePath,
	shouldReuseServer,
} from "./core.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_REL = join("roadmap-board", "src", "server", "cli.js");
const HEALTH_PATH = "/api/roadmap";
const LOCK_STALE_MS = 15_000;
const LOCK_WAIT_MS = 5_000;
const HEALTH_TIMEOUT_MS = 1_500;
const SPAWN_READY_MS = 10_000;

// ---------------------------------------------------------------------------
// CLI resolution — mirrors the skill's scripts/roadmap.mjs so both surfaces
// drive the same validating core.
// ---------------------------------------------------------------------------

/**
 * Locate `roadmap-board/src/server/cli.js`:
 *   1. $ROADMAP_CLI override
 *   2. walk up from `from` for an in-repo checkout
 *   3. bundled copy relative to this extension (agent/extensions/roadmap → repo root)
 */
export function resolveCliPath(from: string): string | null {
	const override = process.env.ROADMAP_CLI;
	if (override && override.trim()) return resolve(override.trim());

	let dir = resolve(from);
	for (;;) {
		const candidate = join(dir, CLI_REL);
		if (existsSync(candidate)) return candidate;
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	const bundled = resolve(HERE, "..", "..", "..", CLI_REL);
	return existsSync(bundled) ? bundled : null;
}

// ---------------------------------------------------------------------------
// Process / port probes
// ---------------------------------------------------------------------------

/** Is this pid a live process? EPERM means alive-but-not-ours; ESRCH means gone. */
export function pidAlive(pid: number): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/** GET the board API on loopback; resolves true on a 200 with a JSON body. */
export function probeHealth(port: number): Promise<boolean> {
	return new Promise((resolveProbe) => {
		const req = request(
			{ host: "127.0.0.1", port, path: HEALTH_PATH, method: "GET", timeout: HEALTH_TIMEOUT_MS },
			(res) => {
				res.resume(); // drain
				resolveProbe(res.statusCode === 200);
			},
		);
		req.on("timeout", () => {
			req.destroy();
			resolveProbe(false);
		});
		req.on("error", () => resolveProbe(false));
		req.end();
	});
}

/** Fetch and parse the full board snapshot from the running server. */
export function fetchSnapshot(port: number): Promise<BoardSnapshot | null> {
	return new Promise((resolveSnap) => {
		const req = request(
			{ host: "127.0.0.1", port, path: HEALTH_PATH, method: "GET", timeout: HEALTH_TIMEOUT_MS },
			(res) => {
				if (res.statusCode !== 200) {
					res.resume();
					resolveSnap(null);
					return;
				}
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk) => (body += chunk));
				res.on("end", () => {
					try {
						resolveSnap(JSON.parse(body) as BoardSnapshot);
					} catch {
						resolveSnap(null);
					}
				});
			},
		);
		req.on("timeout", () => {
			req.destroy();
			resolveSnap(null);
		});
		req.on("error", () => resolveSnap(null));
		req.end();
	});
}

// ---------------------------------------------------------------------------
// Spawn mutex (O_EXCL create with stale recovery)
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function acquireLock(root: string): Promise<void> {
	mkdirSync(roadmapDir(root), { recursive: true });
	const path = lockPath(root);
	const deadline = Date.now() + LOCK_WAIT_MS;
	for (;;) {
		try {
			const fd = openSync(path, "wx"); // O_CREAT | O_EXCL
			writeFileSync(fd, `${Date.now()}\n${process.pid}\n`);
			closeSync(fd);
			return;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			// Steal a stale lock (older than LOCK_STALE_MS) so a crash mid-spawn can't wedge us.
			try {
				if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
					rmSync(path, { force: true });
					continue;
				}
			} catch {
				continue; // lock vanished between stat and now — retry the create
			}
			if (Date.now() > deadline) {
				// Last resort: break the lock rather than abandon the session-start path.
				rmSync(path, { force: true });
				continue;
			}
			await sleep(50);
		}
	}
}

function releaseLock(root: string): void {
	rmSync(lockPath(root), { force: true });
}

function readState(root: string): ServerState | null {
	try {
		return parseServerState(readFileSync(serverStatePath(root), "utf8"));
	} catch {
		return null;
	}
}

function writeState(root: string, state: ServerState): void {
	mkdirSync(roadmapDir(root), { recursive: true });
	writeFileSync(serverStatePath(root), `${JSON.stringify(state, null, 2)}\n`);
}

// ---------------------------------------------------------------------------
// Spawn + health wait
// ---------------------------------------------------------------------------

/**
 * Fingerprint the server source the next spawn would run: a hash over the bytes
 * of every `.js` file in the CLI's directory (cli.js, server.js, model.js). Stamped
 * into state at spawn and re-derived on reuse so a server running pre-edit code is
 * detected and replaced. Returns null when the source can't be read, which makes
 * `shouldReuseServer` skip the version gate rather than thrash. The served client
 * bundle is intentionally excluded — it's read from disk per request, so client
 * edits need no respawn; only the server's own JS does.
 */
export function computeCodeVersion(cliPath: string): string | null {
	try {
		const dir = dirname(cliPath);
		const files = readdirSync(dir)
			.filter((f) => f.endsWith(".js"))
			.sort();
		if (files.length === 0) return null;
		const hash = createHash("sha256");
		for (const file of files) {
			hash.update(file);
			hash.update("\0");
			hash.update(readFileSync(join(dir, file)));
			hash.update("\0");
		}
		return hash.digest("hex").slice(0, 16);
	} catch {
		return null;
	}
}

function spawnServer(cliPath: string, root: string, port: number): number {
	const child = spawn("node", ["--no-warnings", cliPath, "serve", "--port", String(port)], {
		cwd: root,
		env: { ...process.env, ROADMAP_PROJECT_ROOT: root, PORT: String(port) },
		detached: true,
		stdio: "ignore",
	});
	child.unref();
	if (typeof child.pid !== "number") throw new Error("Failed to spawn roadmap server (no pid)");
	return child.pid;
}

async function waitForHealth(port: number, timeoutMs: number): Promise<boolean> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		if (await probeHealth(port)) return true;
		if (Date.now() > deadline) return false;
		await sleep(150);
	}
}

// ---------------------------------------------------------------------------
// Public lifecycle API
// ---------------------------------------------------------------------------

export interface EnsureResult {
	port: number;
	url: string;
	reused: boolean;
	snapshot: BoardSnapshot | null;
}

/**
 * Ensure a server is running for `root` and attach `sessionId` to its refset.
 * Reuses a healthy recorded server, otherwise picks a free port and spawns one.
 * Serialised against other sessions on the same root by the spawn mutex.
 */
export async function ensureServer(root: string, cliPath: string, sessionId: string): Promise<EnsureResult> {
	await acquireLock(root);
	try {
		const existing = readState(root);
		const currentVersion = computeCodeVersion(cliPath);
		const existingAlive = existing ? pidAlive(existing.pid) : false;
		const reuse = shouldReuseServer(existing, {
			pidAlive: existingAlive,
			portHealthy: existing ? await probeHealth(existing.port) : false,
			currentVersion,
		});

		if (reuse && existing) {
			const next = attachRef(existing, sessionId);
			writeState(root, next);
			return {
				port: next.port,
				url: `http://127.0.0.1:${next.port}`,
				reused: true,
				snapshot: await fetchSnapshot(next.port),
			};
		}

		// Not reusing. If the recorded server is still alive (e.g. healthy but running
		// stale code), retire it before respawning so we don't orphan a second process
		// on a second port — the failure mode this version gate exists to prevent.
		if (existing && existingAlive) {
			try {
				process.kill(existing.pid);
			} catch {
				/* already gone */
			}
		}

		const port = await pickFreePort();
		const pid = spawnServer(cliPath, root, port);
		const healthy = await waitForHealth(port, SPAWN_READY_MS);
		if (!healthy) {
			try {
				process.kill(pid);
			} catch {
				/* already gone */
			}
			throw new Error(`Roadmap server did not become healthy on port ${port}`);
		}
		// Inherit the retired server's refset so sessions still attached to it stay
		// covered by the replacement, then ensure our own session is in it.
		const inherited = existing ? existing.refs : [];
		const refs = inherited.includes(sessionId) ? inherited : [...inherited, sessionId];
		const state: ServerState = {
			pid,
			port,
			startedAt: new Date().toISOString(),
			codeVersion: currentVersion ?? "",
			refs,
		};
		writeState(root, state);
		return { port, url: `http://127.0.0.1:${port}`, reused: false, snapshot: await fetchSnapshot(port) };
	} finally {
		releaseLock(root);
	}
}

/**
 * Detach `sessionId`. When it was the last ref, kill the server and remove its
 * state file; otherwise persist the reduced refset (server stays up for others).
 */
export async function detachServer(root: string, sessionId: string): Promise<void> {
	await acquireLock(root);
	try {
		const state = readState(root);
		if (!state) return;
		const next = detachRef(state, sessionId);
		if (next.refs.length === 0) {
			try {
				if (pidAlive(state.pid)) process.kill(state.pid);
			} catch {
				/* already gone */
			}
			rmSync(serverStatePath(root), { force: true });
		} else {
			writeState(root, next);
		}
	} finally {
		releaseLock(root);
	}
}
