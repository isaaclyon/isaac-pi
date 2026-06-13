/**
 * Pure helpers for the roadmap extension.
 *
 * Everything here is side-effect free (the one exception, `pickFreePort`, only
 * touches an ephemeral OS socket) so the tricky lifecycle rules — project-root
 * resolution, lock-file refcount transitions, reuse-vs-respawn, prompt-template
 * filling, board summarisation — can be unit-tested without a Pi runtime or a
 * live server. This mirrors the core.ts / core.test.ts split in ci-watch.
 */

import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** `<root>/.pi/roadmap` — the per-project board directory. */
export function roadmapDir(root: string): string {
	return join(root, ".pi", "roadmap");
}

/** The gitignored SQLite board file whose presence marks an initialized root. */
export function boardDbPath(root: string): string {
	return join(roadmapDir(root), "roadmap.sqlite");
}

/** Refcounted server-lifecycle state file. */
export function serverStatePath(root: string): string {
	return join(roadmapDir(root), ".server.json");
}

/** Short-lived spawn mutex guarding concurrent sessions racing to start a server. */
export function lockPath(root: string): string {
	return join(roadmapDir(root), ".server.lock");
}

/** Committed prompt-action templates. */
export function promptsPath(root: string): string {
	return join(roadmapDir(root), "prompts.json");
}

// ---------------------------------------------------------------------------
// Project-root resolution (one roadmap per repo)
// ---------------------------------------------------------------------------

export interface RootResolveDeps {
	cwd: string;
	env: Record<string, string | undefined>;
	/** Does this absolute path exist on disk? */
	fileExists: (path: string) => boolean;
	/** Canonicalize a path (resolve symlinks). Should fall back to the input if it doesn't exist. */
	realpath: (path: string) => string;
	/**
	 * Absolute path of the repo's *common* git dir (`git rev-parse --git-common-dir`),
	 * already resolved against cwd, or null when cwd isn't inside a git repo. Linked
	 * worktrees report the primary checkout's `.git`, so its parent is the main checkout
	 * that owns the gitignored board.
	 */
	gitCommonDir: string | null;
}

/**
 * Resolve the project root that owns the board, in priority order:
 *   1. $ROADMAP_PROJECT_ROOT (explicit override)
 *   2. parent of the git common dir (so worktrees share the main checkout's board)
 *   3. walk up from cwd for `.pi/roadmap/roadmap.sqlite` (the skill's behavior)
 * Returns the candidate root, or null when none applies. Activation still requires
 * the board file to exist (see `hasBoard`) — env/git candidates may be board-less.
 */
export function resolveProjectRoot(deps: RootResolveDeps): string | null {
	const { cwd, env, fileExists, realpath, gitCommonDir } = deps;

	const envRoot = env.ROADMAP_PROJECT_ROOT;
	if (envRoot && envRoot.trim()) return safeRealpath(realpath, resolve(envRoot.trim()));

	if (gitCommonDir && gitCommonDir.trim()) {
		return dirname(safeRealpath(realpath, resolve(gitCommonDir.trim())));
	}

	return walkUpForBoard(cwd, fileExists, realpath);
}

/** True when the resolved root actually contains an initialized board. */
export function hasBoard(root: string | null, fileExists: (path: string) => boolean): root is string {
	return root !== null && fileExists(boardDbPath(root));
}

function walkUpForBoard(
	startDir: string,
	fileExists: (path: string) => boolean,
	realpath: (path: string) => string,
): string | null {
	let dir = resolve(startDir);
	for (;;) {
		if (fileExists(boardDbPath(dir))) return safeRealpath(realpath, dir);
		const parent = dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

function safeRealpath(realpath: (path: string) => string, path: string): string {
	try {
		return realpath(path);
	} catch {
		return path;
	}
}

// ---------------------------------------------------------------------------
// Server-lifecycle state + refcount transitions
// ---------------------------------------------------------------------------

export interface ServerState {
	pid: number;
	port: number;
	startedAt: string;
	refs: string[];
}

/** Parse `.server.json`, tolerating missing/corrupt content (treated as "no server"). */
export function parseServerState(text: string | null | undefined): ServerState | null {
	if (!text) return null;
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!value || typeof value !== "object") return null;
	const candidate = value as Partial<ServerState>;
	if (typeof candidate.pid !== "number" || typeof candidate.port !== "number") return null;
	const refs = Array.isArray(candidate.refs) ? candidate.refs.filter((r): r is string => typeof r === "string") : [];
	return {
		pid: candidate.pid,
		port: candidate.port,
		startedAt: typeof candidate.startedAt === "string" ? candidate.startedAt : "",
		refs,
	};
}

/** Add a session id to the refset (idempotent). Returns a new state. */
export function attachRef(state: ServerState, sessionId: string): ServerState {
	if (state.refs.includes(sessionId)) return state;
	return { ...state, refs: [...state.refs, sessionId] };
}

/** Remove a session id from the refset. Returns a new state. */
export function detachRef(state: ServerState, sessionId: string): ServerState {
	return { ...state, refs: state.refs.filter((r) => r !== sessionId) };
}

/**
 * Decide whether a recorded server can be reused. Reuse only when we have state,
 * its pid is alive, and the recorded port answers a health probe. A dead pid or
 * an unanswered port is treated as stale → respawn (self-healing after a crash).
 */
export function shouldReuseServer(
	state: ServerState | null,
	probes: { pidAlive: boolean; portHealthy: boolean },
): boolean {
	if (!state) return false;
	return probes.pidAlive && probes.portHealthy;
}

// ---------------------------------------------------------------------------
// Free-port selection
// ---------------------------------------------------------------------------

export function isValidPort(port: unknown): port is number {
	return typeof port === "number" && Number.isInteger(port) && port > 0 && port < 65536;
}

/**
 * Ask the OS for a free TCP port by binding an ephemeral socket on loopback and
 * immediately releasing it. There's an inherent TOCTOU window, but the spawn
 * mutex plus the post-spawn health probe make a lost race recoverable.
 */
export function pickFreePort(): Promise<number> {
	return new Promise((resolvePort, reject) => {
		const srv = createServer();
		srv.unref();
		srv.on("error", reject);
		srv.listen(0, "127.0.0.1", () => {
			const address = srv.address();
			if (address && typeof address === "object") {
				const { port } = address;
				srv.close(() => resolvePort(port));
			} else {
				srv.close(() => reject(new Error("Could not determine a free port")));
			}
		});
	});
}

// ---------------------------------------------------------------------------
// Prompt-template filling
// ---------------------------------------------------------------------------

/** Replace every `{{key}}` placeholder with its value; unknown keys are left intact. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
	return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
		Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match,
	);
}

// ---------------------------------------------------------------------------
// Board snapshot summarisation
// ---------------------------------------------------------------------------

export interface BoardCard {
	id: string;
	title: string;
	status: string;
	epic_id: string | null;
	ready?: boolean;
	dependency_blocked?: boolean;
	claimed_by?: string | null;
	claimed_at?: string | null;
}

export interface BoardEpic {
	id: string;
	title: string;
	done_count: number;
	total_count: number;
	percent_complete: number;
	card_ids: string[];
}

export interface BoardSnapshot {
	columns?: string[];
	prompts?: Record<string, string>;
	cards: BoardCard[];
	epics: BoardEpic[];
}

export function countReady(cards: BoardCard[]): number {
	return cards.filter((c) => c.ready).length;
}

export function countDependencyBlocked(cards: BoardCard[]): number {
	return cards.filter((c) => c.dependency_blocked).length;
}

/** The card the human is actively working: first card in the in_progress column. */
export function findActiveCard(cards: BoardCard[]): BoardCard | undefined {
	return cards.find((c) => c.status === "in_progress");
}

export function findEpic(epics: BoardEpic[], epicId: string | null | undefined): BoardEpic | undefined {
	if (!epicId) return undefined;
	return epics.find((e) => e.id === epicId);
}

/** Cards with an active ownership claim — the coordination view for concurrent sessions. */
export function claimedCards(cards: BoardCard[]): BoardCard[] {
	return cards.filter((c) => !!c.claimed_by);
}

/** A readable prefix for an opaque owner/session id; short human labels pass through. */
export function shortOwner(owner: string | null | undefined, len = 8): string {
	if (!owner) return "";
	return owner.length > 12 ? `${owner.slice(0, len)}…` : owner;
}

/** The one-line session-start notice: URL + ready count + active card. */
export function buildNotifyLine(url: string, snapshot: BoardSnapshot): string {
	const ready = countReady(snapshot.cards);
	const active = findActiveCard(snapshot.cards);
	const tail = active ? `${ready} ready, ${active.id} in progress` : `${ready} ready`;
	return `📋 Roadmap → ${url}  ·  ${tail}`;
}

/** A small unicode progress bar, e.g. `███████░░░`. */
export function progressBar(percent: number, width = 10): string {
	const clamped = Math.max(0, Math.min(100, Math.round(percent)));
	const filled = Math.round((clamped / 100) * width);
	return "█".repeat(filled) + "░".repeat(width - filled);
}

/** Lines for the aboveEditor widget: active card + its epic's progress, else a summary. */
export function buildWidgetLines(snapshot: BoardSnapshot): string[] {
	const active = findActiveCard(snapshot.cards);
	if (active) {
		const lines = [`📋 ${active.id} · ${active.title}`];
		const epic = findEpic(snapshot.epics, active.epic_id);
		if (epic) {
			lines.push(
				`   ${epic.id} ${progressBar(epic.percent_complete)} ${epic.percent_complete}% (${epic.done_count}/${epic.total_count})`,
			);
		}
		return lines;
	}
	const ready = countReady(snapshot.cards);
	const blocked = countDependencyBlocked(snapshot.cards);
	return [`📋 Roadmap · ${ready} ready, ${blocked} blocked`];
}

/** A compact multi-epic summary for `/road` (epic progress + column counts). */
export function buildBoardSummary(snapshot: BoardSnapshot): string {
	const lines: string[] = [];
	const active = findActiveCard(snapshot.cards);
	if (active) lines.push(`In progress: ${active.id} · ${active.title}`);
	lines.push(`Ready: ${countReady(snapshot.cards)}  ·  Dependency-blocked: ${countDependencyBlocked(snapshot.cards)}`);
	const claimed = claimedCards(snapshot.cards);
	if (claimed.length) {
		lines.push("Claimed:");
		for (const c of claimed) lines.push(`  🔒 ${c.id} · ${shortOwner(c.claimed_by)} · ${c.title}`);
	}
	if (snapshot.epics.length) {
		lines.push("Epics:");
		for (const epic of snapshot.epics) {
			lines.push(
				`  ${epic.id} ${progressBar(epic.percent_complete)} ${epic.percent_complete}% (${epic.done_count}/${epic.total_count}) ${epic.title}`,
			);
		}
	}
	return lines.join("\n");
}
