/**
 * Tests for code-review fixes.
 *
 * RED before fixes, GREEN after.
 *
 * Covers:
 *   1. getEvictableItems protects freshTailCount items even when all raw messages are gone
 *   2. strategyUsed captures first progressing strategy (first-wins assignment)
 *   3. applyMigrations applies incremental versioned steps (v1 DB → v2 adds partial index)
 *   4. session_shutdown handler wires closeAllLcmDbs()
 *
 * Run: node --experimental-strip-types agent/extensions/lcm/code-review-fixes-test.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runLcmCompaction } from "./compaction.ts";
import { closeAllLcmDbs, getLcmDb } from "./db.ts";
import { LcmStore } from "./store.ts";
import { toStoredMessage } from "./types.ts";

function makeConv(store, key) {
	return store.getOrCreateConversation({ conversationKey: key, sessionFile: null, cwd: "/tmp" });
}

function ins(store, cid, i) {
	store.insertMessage(cid, toStoredMessage({
		role: i % 2 === 0 ? "user" : "assistant",
		content: [{ type: "text", text: `msg ${i} ${"word ".repeat(40)}` }],
		timestamp: Date.now() + i,
		...(i % 2 !== 0 ? {
			api: "anthropic", provider: "anthropic", model: "x",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "end_turn",
		} : {}),
	}, null));
}

// ---------------------------------------------------------------------------
// Test 1: getEvictableItems — freshTailCount protection survives full compaction
//
// Trigger: once all raw messages have been compacted into summaries, the only
// remaining items in context_items are summaries. The bug returns ALL of them as
// evictable (messageItems.length === 0 → return [...items]), allowing a subsequent
// condensed pass to collapse every summary — defeating freshTailCount protection.
//
// We simulate the fully-compacted state by manually deleting message rows from
// context_items after the first compaction. With freshTailCount=2, at least 2
// items must survive the second compaction pass.
// ---------------------------------------------------------------------------
async function testEvictableItemsFullyCompacted(store, db) {
	const conv = makeConv(store, "fix-evictable");
	const cid = conv.conversationId;

	// 16 messages with incrementalMaxDepth=0 → leaf-only compaction, NO condensed passes.
	// This leaves multiple depth=0 leaf summaries + 1 raw tail message.
	for (let i = 0; i < 16; i++) ins(store, cid, i);
	await runLcmCompaction(store, {
		conversationId: cid, targetTokens: 1,
		freshTailCount: 1, leafChunkTokens: 300, incrementalMaxDepth: 0, // leaf only
	});

	// Force all-summary state: remove remaining raw message from context_items
	db.prepare("DELETE FROM context_items WHERE conversation_id = ? AND item_type = 'message'").run(cid);

	const allSummaryItems = store.listContextItems(cid);
	assert.ok(allSummaryItems.length >= 2,
		`precondition: need ≥2 summaries to expose bug, got ${allSummaryItems.length}`);
	assert.ok(allSummaryItems.every((i) => i.itemType === "summary"),
		"precondition: all items must be summaries");

	// Second compaction with freshTailCount=2:
	//   Bug: getEvictableItems returns ALL summaries as evictable (messageItems=[])
	//        → condensed pass collapses all N summaries into 1 → only 1 item survives
	//   Fix: last 2 summaries protected → condensed can only touch the rest
	//        → at least 2 items survive
	await runLcmCompaction(store, {
		conversationId: cid, targetTokens: 1,
		freshTailCount: 2, leafChunkTokens: 300, incrementalMaxDepth: 3,
	});

	const finalItems = store.listContextItems(cid);
	assert.ok(
		finalItems.length >= 2,
		`freshTailCount=2 with ${allSummaryItems.length} summaries: expected ≥2 items to survive, got ${finalItems.length}`,
	);
}

// ---------------------------------------------------------------------------
// Test 2: strategyUsed = first progressing strategy
//
// The bug: `strategyUsed` is overwritten on every strategy loop iteration that
// makes any progress, so the last-progressing strategy is reported, not the first.
// In practice this is hard to trigger because strategies share identical structural
// logic (normal exhausts all work before aggressive runs). The fix (first-wins
// assignment) is still correct and this test verifies the intended semantics:
// when normal makes all the progress, strategyUsed must be "normal", not null.
// ---------------------------------------------------------------------------
async function testStrategyUsedIsFirst(store) {
	const conv = makeConv(store, "fix-strategy");
	const cid = conv.conversationId;

	for (let i = 0; i < 30; i++) ins(store, cid, i);

	const result = await runLcmCompaction(store, {
		conversationId: cid, targetTokens: 20,
		freshTailCount: 2, leafChunkTokens: 400, incrementalMaxDepth: 1,
	});

	// Normal strategy does all the work — must be captured as first-progressing strategy.
	// Bug would manifest as "aggressive" or "fallback" if those strategies ran after normal.
	assert.equal(result.strategyUsed, "normal",
		`strategyUsed must be "normal" (first to progress), got "${result.strategyUsed}"`);
}

// ---------------------------------------------------------------------------
// Test 3: incremental migration — v1 DB gets partial index without table recreation
//
// The current applyMigrations re-runs the full schema SQL (CREATE TABLE IF NOT EXISTS
// for all tables). This is idempotent for existing tables but can never apply
// ALTER TABLE, new indexes, or constraint changes to an existing schema. The fix
// uses per-version migration steps that apply ONLY the delta for each version.
//
// This test verifies: a v1 database (tables exist, no partial index) gets the
// idx_messages_unique_entry index added by v2 without losing existing rows.
// ---------------------------------------------------------------------------
function testIncrementalMigration(tempDir) {
	const dbPath = join(tempDir, "migration-test.sqlite");

	// Build a v1 database manually: full schema WITHOUT the partial unique index
	const v1Db = new DatabaseSync(dbPath);
	v1Db.exec(`
		CREATE TABLE conversations (
			conversation_id INTEGER PRIMARY KEY AUTOINCREMENT,
			conversation_key TEXT NOT NULL UNIQUE,
			session_file TEXT,
			cwd TEXT NOT NULL,
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);
		CREATE TABLE messages (
			message_id INTEGER PRIMARY KEY AUTOINCREMENT,
			conversation_id INTEGER NOT NULL,
			seq INTEGER NOT NULL,
			entry_id TEXT,
			role TEXT NOT NULL,
			content_text TEXT NOT NULL,
			content_json TEXT,
			token_estimate INTEGER NOT NULL,
			created_at INTEGER NOT NULL
		);
		CREATE INDEX idx_messages_conversation_seq ON messages(conversation_id, seq);
		CREATE TABLE summaries (
			summary_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
			summary_id TEXT NOT NULL UNIQUE,
			conversation_id INTEGER NOT NULL,
			depth INTEGER NOT NULL,
			kind TEXT NOT NULL,
			content TEXT NOT NULL,
			token_estimate INTEGER NOT NULL,
			earliest_at INTEGER,
			latest_at INTEGER,
			created_at INTEGER NOT NULL
		);
		CREATE TABLE summary_messages (
			summary_id TEXT NOT NULL, message_id INTEGER NOT NULL, ordinal INTEGER NOT NULL,
			PRIMARY KEY (summary_id, message_id)
		);
		CREATE TABLE summary_parents (
			summary_id TEXT NOT NULL, parent_summary_id TEXT NOT NULL, ordinal INTEGER NOT NULL,
			PRIMARY KEY (summary_id, parent_summary_id)
		);
		CREATE TABLE context_items (
			context_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
			conversation_id INTEGER NOT NULL,
			ordinal INTEGER NOT NULL,
			item_type TEXT NOT NULL,
			message_id INTEGER,
			summary_id TEXT,
			created_at INTEGER NOT NULL
		);
		PRAGMA user_version = 1;
	`);

	// Seed data that must survive migration
	v1Db.exec(`INSERT INTO conversations (conversation_key, cwd, created_at, updated_at) VALUES ('mig-test', '/tmp', 0, 0)`);
	v1Db.exec(`INSERT INTO messages (conversation_id, seq, entry_id, role, content_text, token_estimate, created_at) VALUES (1, 1, NULL, 'user', 'hello', 1, 0)`);
	v1Db.exec(`INSERT INTO messages (conversation_id, seq, entry_id, role, content_text, token_estimate, created_at) VALUES (1, 2, NULL, 'user', 'world', 1, 0)`);
	v1Db.close();

	// Open via getLcmDb — must run v2 migration step (add partial index only)
	const db = getLcmDb(dbPath);

	const version = db.prepare("PRAGMA user_version").get();
	assert.equal(Number(version.user_version), 2, "user_version must be 2 after migration");

	const idxRow = db.prepare(
		`SELECT name FROM sqlite_master WHERE type='index' AND name='idx_messages_unique_entry'`,
	).get();
	assert.ok(idxRow, "v2 migration must add idx_messages_unique_entry partial index");

	// Existing rows MUST survive — migration must not drop/recreate tables
	const msgCount = db.prepare("SELECT COUNT(*) AS c FROM messages").get();
	assert.equal(Number(msgCount.c), 2, "existing rows must survive incremental migration");
}

// ---------------------------------------------------------------------------
// Test 4: session_shutdown handler registered in index.ts
// ---------------------------------------------------------------------------
async function testShutdownHookRegistered() {
	const { readFileSync } = await import("node:fs");
	const { fileURLToPath } = await import("node:url");
	const { dirname: dn, join: j } = await import("node:path");
	const dir = dn(fileURLToPath(import.meta.url));
	const src = readFileSync(j(dir, "index.ts"), "utf8");

	assert.ok(
		src.includes('"session_shutdown"') || src.includes("'session_shutdown'"),
		'index.ts must register a pi.on("session_shutdown", ...) handler',
	);
	assert.ok(
		src.includes("closeAllLcmDbs"),
		"index.ts must call closeAllLcmDbs() in the shutdown handler",
	);
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------
async function run() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-lcm-crfix-"));
	try {
		const dbPath = join(tempDir, "main.sqlite");
		const db = getLcmDb(dbPath);
		const store = new LcmStore(db);

		await testEvictableItemsFullyCompacted(store, db);
		console.log("  ✓ getEvictableItems: freshTailCount protects items even when all raw messages compacted");

		await testStrategyUsedIsFirst(store);
		console.log('  ✓ strategyUsed: first-progressing strategy captured ("normal")');

		closeAllLcmDbs();
		testIncrementalMigration(tempDir);
		closeAllLcmDbs();
		console.log("  ✓ migrations: v1→v2 adds partial index without dropping tables or losing rows");

		await testShutdownHookRegistered();
		console.log('  ✓ session_shutdown hook registered + closeAllLcmDbs() wired');

		console.log("\nCode-review fixes test passed");
	} finally {
		closeAllLcmDbs();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

run().catch((err) => {
	console.error(err);
	process.exit(1);
});
