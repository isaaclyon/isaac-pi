import assert from "node:assert/strict";
import { connect } from "node:net";
import test from "node:test";
import {
	activityGlyph,
	attachRef,
	type BoardSnapshot,
	boardDbPath,
	buildActivityLines,
	buildBoardSummary,
	buildNotifyLine,
	buildWidgetLines,
	claimedCards,
	countReady,
	curateToolTitle,
	describeMilestone,
	detachRef,
	fillTemplate,
	findActiveCard,
	hasBoard,
	isValidPort,
	parseServerState,
	pickFreePort,
	progressBar,
	relativeAge,
	resolveProjectRoot,
	type RootResolveDeps,
	type ServerState,
	shapeActivity,
	shortOwner,
	shouldReuseServer,
	sendRoadmapHandoff,
	type TimelineItem,
	truncateLabel,
	userMessageOptions,
} from "./core.ts";

// --- project-root resolution ---------------------------------------------

const baseDeps = (over: Partial<RootResolveDeps>): RootResolveDeps => ({
	cwd: "/repo/sub/dir",
	env: {},
	fileExists: () => false,
	realpath: (p) => p,
	gitCommonDir: null,
	...over,
});

test("env override wins and is realpath-canonicalized", () => {
	const root = resolveProjectRoot(
		baseDeps({
			env: { ROADMAP_PROJECT_ROOT: "/explicit/root" },
			realpath: (p) => (p === "/explicit/root" ? "/canonical/root" : p),
		}),
	);
	assert.equal(root, "/canonical/root");
});

test("git common dir resolves a worktree to the main checkout (its parent)", () => {
	// `git rev-parse --git-common-dir` from a linked worktree points at the primary .git.
	const root = resolveProjectRoot(baseDeps({ gitCommonDir: "/repo/.git" }));
	assert.equal(root, "/repo");
});

test("walk-up finds the nearest ancestor holding the board db", () => {
	const board = boardDbPath("/repo");
	const root = resolveProjectRoot(
		baseDeps({
			cwd: "/repo/sub/dir",
			fileExists: (p) => p === board,
		}),
	);
	assert.equal(root, "/repo");
});

test("resolution returns null with no env, no git, no board upward", () => {
	assert.equal(resolveProjectRoot(baseDeps({})), null);
});

test("hasBoard gates activation on the db file existing", () => {
	const board = boardDbPath("/repo");
	assert.equal(hasBoard("/repo", (p) => p === board), true);
	assert.equal(hasBoard("/repo", () => false), false);
	assert.equal(hasBoard(null, () => true), false);
});

// --- server state + refcount transitions ----------------------------------

test("parseServerState tolerates missing / corrupt / partial content", () => {
	assert.equal(parseServerState(undefined), null);
	assert.equal(parseServerState(""), null);
	assert.equal(parseServerState("{not json"), null);
	assert.equal(parseServerState(JSON.stringify({ port: 1 })), null); // no pid
	const ok = parseServerState(JSON.stringify({ pid: 5, port: 4177, startedAt: "t", codeVersion: "v1", refs: ["a", 1, "b"] }));
	assert.deepEqual(ok, { pid: 5, port: 4177, startedAt: "t", codeVersion: "v1", refs: ["a", "b"] });
	// Pre-stamping state files have no codeVersion → defaults to "" (reads as stale under the version gate).
	const legacy = parseServerState(JSON.stringify({ pid: 5, port: 4177, startedAt: "t", refs: [] }));
	assert.equal(legacy?.codeVersion, "");
});

test("attachRef is idempotent; detachRef removes one id", () => {
	const state: ServerState = { pid: 1, port: 2, startedAt: "t", codeVersion: "v1", refs: ["a"] };
	assert.deepEqual(attachRef(state, "b").refs, ["a", "b"]);
	assert.deepEqual(attachRef(state, "a").refs, ["a"]);
	assert.deepEqual(detachRef(attachRef(state, "b"), "a").refs, ["b"]);
	assert.deepEqual(detachRef(state, "a").refs, []);
});

test("shouldReuseServer requires live pid AND healthy port", () => {
	const state: ServerState = { pid: 1, port: 2, startedAt: "t", codeVersion: "v1", refs: [] };
	assert.equal(shouldReuseServer(null, { pidAlive: true, portHealthy: true }), false);
	assert.equal(shouldReuseServer(state, { pidAlive: true, portHealthy: true }), true);
	assert.equal(shouldReuseServer(state, { pidAlive: false, portHealthy: true }), false);
	assert.equal(shouldReuseServer(state, { pidAlive: true, portHealthy: false }), false);
});

test("shouldReuseServer retires a server running stale code", () => {
	const state: ServerState = { pid: 1, port: 2, startedAt: "t", codeVersion: "v1", refs: [] };
	// Matching fingerprint → reuse the healthy server.
	assert.equal(shouldReuseServer(state, { pidAlive: true, portHealthy: true, currentVersion: "v1" }), true);
	// Source changed since spawn → respawn even though pid+port are healthy.
	assert.equal(shouldReuseServer(state, { pidAlive: true, portHealthy: true, currentVersion: "v2" }), false);
	// Pre-stamping (blank) recorded version against a known current version → stale.
	const legacy: ServerState = { ...state, codeVersion: "" };
	assert.equal(shouldReuseServer(legacy, { pidAlive: true, portHealthy: true, currentVersion: "v1" }), false);
	// Fingerprint unavailable (null) → version gate skipped, fall back to pid+port health.
	assert.equal(shouldReuseServer(legacy, { pidAlive: true, portHealthy: true, currentVersion: null }), true);
	assert.equal(shouldReuseServer(state, { pidAlive: true, portHealthy: true, currentVersion: null }), true);
});

// --- free port -------------------------------------------------------------

test("isValidPort accepts in-range integers only", () => {
	assert.equal(isValidPort(4177), true);
	assert.equal(isValidPort(0), false);
	assert.equal(isValidPort(70000), false);
	assert.equal(isValidPort(4177.5), false);
	assert.equal(isValidPort("4177"), false);
});

test("pickFreePort returns a bindable loopback port", async () => {
	const port = await pickFreePort();
	assert.equal(isValidPort(port), true);
	// Nothing should be listening on the just-released port.
	await assert.rejects(
		() =>
			new Promise<void>((resolveConn, reject) => {
				const socket = connect(port, "127.0.0.1");
				socket.once("connect", () => {
					socket.destroy();
					resolveConn();
				});
				socket.once("error", reject);
			}),
	);
});

// --- template filling ------------------------------------------------------

test("fillTemplate substitutes known keys and leaves unknown ones intact", () => {
	assert.equal(
		fillTemplate("Plan {{id}}: {{title}} ({{id}})", { id: "ROAD-007", title: "Widget" }),
		"Plan ROAD-007: Widget (ROAD-007)",
	);
	assert.equal(fillTemplate("keep {{unknown}}", { id: "x" }), "keep {{unknown}}");
});

test("userMessageOptions queues roadmap handoffs as steer only while busy", () => {
	assert.equal(userMessageOptions(true), undefined);
	assert.deepEqual(userMessageOptions(false), { deliverAs: "steer" });
});

test("sendRoadmapHandoff sends immediately when idle and steers when busy", () => {
	const calls: Array<{ message: string; options?: { deliverAs: "steer" } }> = [];
	const send = (message: string, options?: { deliverAs: "steer" }) => calls.push({ message, options });

	sendRoadmapHandoff(send, true, "Plan ROAD-001");
	sendRoadmapHandoff(send, false, "Plan ROAD-002");

	assert.deepEqual(calls, [
		{ message: "Plan ROAD-001", options: undefined },
		{ message: "Plan ROAD-002", options: { deliverAs: "steer" } },
	]);
});

// --- summarisation ---------------------------------------------------------

const snapshot: BoardSnapshot = {
	cards: [
		{ id: "ROAD-001", title: "Done", status: "completed", epic_id: "EPIC-001" },
		{ id: "ROAD-017", title: "Agent epic reorder", status: "in_progress", epic_id: "EPIC-004", ready: false },
		{ id: "ROAD-018", title: "Pickable", status: "backlog", epic_id: null, ready: true },
		{ id: "ROAD-019", title: "Waiting", status: "backlog", epic_id: null, dependency_blocked: true },
	],
	epics: [{ id: "EPIC-004", title: "Robustness", done_count: 4, total_count: 6, percent_complete: 67, card_ids: [] }],
};

test("countReady / findActiveCard read the snapshot signals", () => {
	assert.equal(countReady(snapshot.cards), 1);
	assert.equal(findActiveCard(snapshot.cards)?.id, "ROAD-017");
});

test("buildNotifyLine includes URL, ready count and active card", () => {
	const line = buildNotifyLine("http://127.0.0.1:4177", snapshot);
	assert.match(line, /http:\/\/127\.0\.0\.1:4177/);
	assert.match(line, /1 ready/);
	assert.match(line, /ROAD-017 in progress/);
});

test("buildNotifyLine omits active card when nothing is in progress", () => {
	const idle: BoardSnapshot = { cards: [{ id: "x", title: "t", status: "backlog", epic_id: null, ready: true }], epics: [] };
	const line = buildNotifyLine("http://h", idle);
	assert.match(line, /1 ready$/);
});

test("buildWidgetLines shows the active card and its epic progress", () => {
	const lines = buildWidgetLines(snapshot);
	assert.match(lines[0], /ROAD-017 · Agent epic reorder/);
	assert.match(lines[1], /EPIC-004/);
	assert.match(lines[1], /67% \(4\/6\)/);
});

test("buildWidgetLines falls back to a summary with no active card", () => {
	const idle: BoardSnapshot = {
		cards: [
			{ id: "x", title: "t", status: "backlog", epic_id: null, ready: true },
			{ id: "y", title: "t", status: "backlog", epic_id: null, dependency_blocked: true },
		],
		epics: [],
	};
	const lines = buildWidgetLines(idle);
	assert.equal(lines.length, 1);
	assert.match(lines[0], /1 ready, 1 blocked/);
});

test("progressBar clamps and fills proportionally", () => {
	assert.equal(progressBar(0, 10), "░░░░░░░░░░");
	assert.equal(progressBar(100, 10), "██████████");
	assert.equal(progressBar(50, 10), "█████░░░░░");
	assert.equal(progressBar(150, 4), "████");
});

test("shortOwner abbreviates long opaque ids but passes short labels through", () => {
	assert.equal(shortOwner("alice"), "alice");
	assert.equal(shortOwner("019ec248-05df-7506"), "019ec248…");
	assert.equal(shortOwner(null), "");
	assert.equal(shortOwner(undefined), "");
});

test("claimedCards selects only cards with an active claim", () => {
	const cards = [
		{ id: "A", title: "a", status: "in_progress", epic_id: null, claimed_by: "sess-1" },
		{ id: "B", title: "b", status: "backlog", epic_id: null, claimed_by: null },
		{ id: "C", title: "c", status: "up_next", epic_id: null },
	];
	assert.deepEqual(claimedCards(cards).map((c) => c.id), ["A"]);
});

test("buildBoardSummary lists claimed cards with their owner", () => {
	const snap: BoardSnapshot = {
		cards: [
			{ id: "ROAD-024", title: "Ownership claims", status: "in_progress", epic_id: null, claimed_by: "019ec248-05df-7506" },
			{ id: "ROAD-025", title: "Timeline", status: "backlog", epic_id: null },
		],
		epics: [],
	};
	const summary = buildBoardSummary(snap);
	assert.match(summary, /Claimed:/);
	assert.match(summary, /🔒 ROAD-024 · 019ec248… · Ownership claims/);
});

// --- live activity shaping (ROAD-025) ------------------------------------

test("shapeActivity maps lifecycle events to kind/title/status", () => {
	assert.deepEqual(shapeActivity({ type: "agent_start" }), {
		kind: "agent_start",
		title: "Agent started working",
		status: "running",
	});
	assert.deepEqual(shapeActivity({ type: "agent_end" }), { kind: "agent_end", title: "Agent finished", status: "done" });
	assert.equal(shapeActivity({ type: "model_select", modelName: "claude-opus-4-8" })?.title, "Model → claude-opus-4-8");
	assert.equal(shapeActivity({ type: "session_shutdown" })?.kind, "session_shutdown");
});

test("shapeActivity flags tool errors and returns null for uncaptured events", () => {
	const start = shapeActivity({ type: "tool_execution_start", toolName: "Grep", args: { pattern: "TODO" } });
	assert.deepEqual(start, { kind: "tool_start", title: "Grep: TODO", status: "running" });

	const ok = shapeActivity({ type: "tool_execution_end", toolName: "Read", isError: false });
	assert.equal(ok?.status, "ok");
	const err = shapeActivity({ type: "tool_execution_end", toolName: "Bash", isError: true });
	assert.deepEqual(err, { kind: "tool_end", title: "Bash failed", status: "error" });

	// message_update (token streaming) and anything unknown are deliberately dropped.
	assert.equal(shapeActivity({ type: "message_update" }), null);
});

test("curateToolTitle never leaks bash commands, contents, or results — only safe hints", () => {
	// Bash: the human description is surfaced, the command body is NOT.
	const bash = curateToolTitle("Bash", { command: "cat /Users/me/.env && curl http://evil", description: "read env" });
	assert.equal(bash, "Bash: read env");
	assert.ok(!bash.includes("curl") && !bash.includes(".env"));

	// File tools show only the basename, not the full path.
	assert.equal(curateToolTitle("Edit", { file_path: "/Users/me/.pi/roadmap-board/src/server/activity.js" }), "Edit: activity.js");
	// Unknown tools fall back to the bare name.
	assert.equal(curateToolTitle("MysteryTool", { secret: "x" }), "MysteryTool");
	// WebFetch reduces a url to its host.
	assert.equal(curateToolTitle("WebFetch", { url: "https://example.com/a/b?token=abc" }), "WebFetch: example.com");
});

test("truncateLabel collapses whitespace and clips long labels", () => {
	assert.equal(truncateLabel("a   b\n c"), "a b c");
	const long = truncateLabel("x".repeat(100), 10);
	assert.equal(long.length, 10);
	assert.ok(long.endsWith("…"));
});

test("relativeAge renders compact, monotonic units", () => {
	const now = Date.parse("2026-06-13T00:10:00.000Z");
	assert.equal(relativeAge("2026-06-13T00:09:55.000Z", now), "5s");
	assert.equal(relativeAge("2026-06-13T00:08:00.000Z", now), "2m");
	assert.equal(relativeAge("2026-06-12T22:10:00.000Z", now), "2h");
	assert.equal(relativeAge("not-a-date", now), "");
});

test("activityGlyph and describeMilestone render both timeline halves", () => {
	assert.equal(activityGlyph({ source: "activity", status: "running" }), "⟳");
	assert.equal(activityGlyph({ source: "activity", status: "error" }), "✗");
	assert.equal(activityGlyph({ source: "milestone", status: null }), "•");

	const moved: TimelineItem = { source: "milestone", ts: "", kind: "card_moved", payload: { from: "up_next", to: "in_progress" } };
	assert.equal(describeMilestone(moved), "moved up_next → in_progress");
	const claimed: TimelineItem = { source: "milestone", ts: "", kind: "card_claimed", payload: { owner: "019ec248-05df-7506" } };
	assert.equal(describeMilestone(claimed), "claimed by 019ec248…");
	const stolen: TimelineItem = { source: "milestone", ts: "", kind: "card_claimed", payload: { owner: "bob", stolen_from: "alice" } };
	assert.equal(describeMilestone(stolen), "claim stolen from alice");
});

test("buildActivityLines renders items and a clear empty hint", () => {
	const now = Date.parse("2026-06-13T00:00:30.000Z");
	const items: TimelineItem[] = [
		{ source: "activity", ts: "2026-06-13T00:00:25.000Z", kind: "tool_start", title: "Grep: TODO", status: "running", card_id: "ROAD-25" },
		{ source: "milestone", ts: "2026-06-13T00:00:00.000Z", kind: "card_claimed", payload: { owner: "sess" }, card_id: "ROAD-25" },
	];
	const lines = buildActivityLines(items, now);
	assert.match(lines[0], /⟳\s+5s ROAD-25\s+Grep: TODO/);
	assert.match(lines[1], /• \s*30s ROAD-25\s+claimed by sess/);

	assert.match(buildActivityLines([], now)[0], /No recent activity/);
});
