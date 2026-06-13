import assert from "node:assert/strict";
import { connect } from "node:net";
import test from "node:test";
import {
	attachRef,
	type BoardSnapshot,
	boardDbPath,
	buildBoardSummary,
	buildNotifyLine,
	buildWidgetLines,
	claimedCards,
	countReady,
	detachRef,
	fillTemplate,
	findActiveCard,
	hasBoard,
	isValidPort,
	parseServerState,
	pickFreePort,
	progressBar,
	resolveProjectRoot,
	type RootResolveDeps,
	type ServerState,
	shortOwner,
	shouldReuseServer,
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
	const ok = parseServerState(JSON.stringify({ pid: 5, port: 4177, startedAt: "t", refs: ["a", 1, "b"] }));
	assert.deepEqual(ok, { pid: 5, port: 4177, startedAt: "t", refs: ["a", "b"] });
});

test("attachRef is idempotent; detachRef removes one id", () => {
	const state: ServerState = { pid: 1, port: 2, startedAt: "t", refs: ["a"] };
	assert.deepEqual(attachRef(state, "b").refs, ["a", "b"]);
	assert.deepEqual(attachRef(state, "a").refs, ["a"]);
	assert.deepEqual(detachRef(attachRef(state, "b"), "a").refs, ["b"]);
	assert.deepEqual(detachRef(state, "a").refs, []);
});

test("shouldReuseServer requires live pid AND healthy port", () => {
	const state: ServerState = { pid: 1, port: 2, startedAt: "t", refs: [] };
	assert.equal(shouldReuseServer(null, { pidAlive: true, portHealthy: true }), false);
	assert.equal(shouldReuseServer(state, { pidAlive: true, portHealthy: true }), true);
	assert.equal(shouldReuseServer(state, { pidAlive: false, portHealthy: true }), false);
	assert.equal(shouldReuseServer(state, { pidAlive: true, portHealthy: false }), false);
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
