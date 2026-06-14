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
	/**
	 * Fingerprint of the server source the process was spawned from. Reuse compares
	 * this against the current on-disk fingerprint so a long-lived but code-stale
	 * server is retired instead of reused. Blank for pre-stamping state files.
	 */
	codeVersion: string;
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
		codeVersion: typeof candidate.codeVersion === "string" ? candidate.codeVersion : "",
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
 * its pid is alive, the recorded port answers a health probe, and — when we can
 * fingerprint the current server source — it was spawned from that same source.
 * A dead pid, an unanswered port, or a code-version mismatch is treated as stale
 * → respawn (self-healing after a crash, and auto-replacement after a code change).
 *
 * `currentVersion` is the on-disk source fingerprint, or null when it can't be
 * computed; null skips the version gate so a fingerprinting failure never wedges
 * session start into an endless respawn loop. A blank recorded `codeVersion`
 * (pre-stamping state) reads as stale whenever a current version is available.
 */
export function shouldReuseServer(
	state: ServerState | null,
	probes: { pidAlive: boolean; portHealthy: boolean; currentVersion?: string | null },
): boolean {
	if (!state) return false;
	if (!probes.pidAlive || !probes.portHealthy) return false;
	const current = probes.currentVersion;
	if (current != null && (!state.codeVersion || state.codeVersion !== current)) return false;
	return true;
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

// ---------------------------------------------------------------------------
// Live activity timeline (ROAD-025)
//
// The extension captures a curated set of Pi lifecycle events and fire-and-forget
// POSTs each one to the board server's in-RAM ring. Everything in this section is the
// pure shaping/formatting half — what to send and how to render it — kept side-effect
// free so it's unit-tested without a Pi runtime (the POST/GET I/O lives in server.ts).
// ---------------------------------------------------------------------------

export type ActivityStatus = "running" | "ok" | "error" | "done" | "info";

/** The shaped record the extension sends per event (the server adds session/card/ts). */
export interface ShapedActivity {
	kind: string;
	title: string;
	status: ActivityStatus;
}

/** Discriminated input to `shapeActivity` — the subset of each Pi event we actually use. */
export interface ActivityEventInput {
	type: string;
	toolName?: string;
	args?: unknown;
	isError?: boolean;
	modelName?: string;
}

const ACTIVITY_TITLE_MAX = 72;

/** Collapse whitespace and clip to a one-line label so the feed never wraps or bloats. */
export function truncateLabel(text: string, max = ACTIVITY_TITLE_MAX): string {
	const t = text.replace(/\s+/g, " ").trim();
	return t.length > max ? `${t.slice(0, Math.max(0, max - 1))}…` : t;
}

function baseName(p: string | undefined): string | undefined {
	if (!p) return undefined;
	const parts = p.split(/[\\/]/).filter(Boolean);
	return parts.length ? parts[parts.length - 1] : p;
}

function hostOf(url: string | undefined): string | undefined {
	if (!url) return undefined;
	try {
		return new URL(url).host;
	} catch {
		return undefined;
	}
}

/**
 * One curated, non-sensitive hint for a tool execution. SECURITY: this never returns a
 * bash command body, file contents, or a tool result — only a path basename, a search
 * pattern, a host, or a human-authored description. For `Bash` it reads `args.description`
 * and pointedly ignores `args.command`. Unknown tools fall back to no hint (name only).
 */
function toolArgHint(name: string, args: unknown): string | undefined {
	if (!args || typeof args !== "object") return undefined;
	const a = args as Record<string, unknown>;
	const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
	switch (name) {
		case "Bash":
			return str(a.description); // human description only — never a.command
		case "Read":
		case "Edit":
		case "Write":
		case "NotebookEdit":
			return baseName(str(a.file_path) ?? str(a.notebook_path));
		case "Grep":
		case "Glob":
			return str(a.pattern);
		case "Task":
		case "Agent":
			return str(a.description);
		case "WebFetch":
			return hostOf(str(a.url));
		default:
			return undefined;
	}
}

/** A short, safe descriptor for a tool call: `<tool>` or `<tool>: <hint>`, truncated. */
export function curateToolTitle(toolName: string | undefined, args: unknown): string {
	const name = (toolName ?? "").trim() || "tool";
	const hint = toolArgHint(name, args);
	return truncateLabel(hint ? `${name}: ${hint}` : name);
}

/**
 * Map a captured Pi lifecycle event to a shaped activity record, or null for events we
 * deliberately don't surface. `message_update` (token streaming) is intentionally absent —
 * it's far too chatty for a feed.
 */
export function shapeActivity(event: ActivityEventInput): ShapedActivity | null {
	switch (event.type) {
		case "agent_start":
			return { kind: "agent_start", title: "Agent started working", status: "running" };
		case "agent_end":
			return { kind: "agent_end", title: "Agent finished", status: "done" };
		case "tool_execution_start":
			return { kind: "tool_start", title: curateToolTitle(event.toolName, event.args), status: "running" };
		case "tool_execution_end": {
			const name = (event.toolName ?? "").trim() || "tool";
			return {
				kind: "tool_end",
				title: event.isError ? `${name} failed` : `${name} done`,
				status: event.isError ? "error" : "ok",
			};
		}
		case "model_select":
			return { kind: "model_select", title: `Model → ${(event.modelName ?? "").trim() || "unknown"}`, status: "info" };
		case "session_start":
			return { kind: "session_start", title: "Session started", status: "info" };
		case "session_shutdown":
			return { kind: "session_shutdown", title: "Session ended", status: "info" };
		default:
			return null;
	}
}

/** A merged timeline item as returned by GET /api/timeline (both sources normalized). */
export interface TimelineItem {
	source: "activity" | "milestone";
	ts: string;
	kind: string;
	title?: string;
	status?: string | null;
	session?: string | null;
	card_id?: string | null;
	card_title?: string | null;
	actor_type?: string | null;
	payload?: Record<string, unknown>;
}

/** A compact age like `5s`, `3m`, `2h`, `4d` for a timeline line. */
export function relativeAge(ts: string, nowMs: number): string {
	const then = Date.parse(ts);
	if (Number.isNaN(then)) return "";
	const secs = Math.max(0, Math.round((nowMs - then) / 1000));
	if (secs < 60) return `${secs}s`;
	const mins = Math.round(secs / 60);
	if (mins < 60) return `${mins}m`;
	const hrs = Math.round(mins / 60);
	if (hrs < 24) return `${hrs}h`;
	return `${Math.round(hrs / 24)}d`;
}

/** A glyph cueing an item's nature: live status (running/ok/error/done) or a milestone dot. */
export function activityGlyph(item: Pick<TimelineItem, "source" | "status">): string {
	if (item.source === "milestone") return "•";
	switch (item.status) {
		case "running":
			return "⟳";
		case "error":
			return "✗";
		case "ok":
		case "done":
			return "✓";
		default:
			return "·";
	}
}

/** Human label for a milestone item (claims/moves), mirroring the board's event vocabulary. */
export function describeMilestone(item: TimelineItem): string {
	const p = item.payload ?? {};
	switch (item.kind) {
		case "card_moved":
			return `moved ${p.from ?? "?"} → ${p.to ?? "?"}`;
		case "card_claimed":
			return p.stolen_from ? `claim stolen from ${shortOwner(String(p.stolen_from))}` : `claimed by ${shortOwner(String(p.owner ?? ""))}`;
		case "card_released":
			return `released by ${shortOwner(String(p.owner ?? ""))}`;
		default:
			return item.kind;
	}
}

/** The display text for any timeline item: live title, or a described milestone. */
export function describeActivityItem(item: TimelineItem): string {
	return item.source === "milestone" ? describeMilestone(item) : item.title || item.kind;
}

/** One rendered line for `/road activity`: glyph · age · card · description. */
export function buildActivityLines(items: TimelineItem[], nowMs: number): string[] {
	if (!items.length) return ["No recent activity. (Is a session running? The live buffer needs the board server.)"];
	return items.map((item) => {
		const age = relativeAge(item.ts, nowMs).padStart(3);
		const card = item.card_id ? ` ${item.card_id}` : "";
		return `${activityGlyph(item)} ${age}${card}  ${describeActivityItem(item)}`;
	});
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
