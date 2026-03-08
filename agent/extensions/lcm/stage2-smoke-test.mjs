import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runLcmCompaction } from "./compaction.ts";
import { closeAllLcmDbs, getLcmDb } from "./db.ts";
import { LcmStore } from "./store.ts";

async function runPrimaryScenario(store) {
	const conversation = store.getOrCreateConversation({
		conversationKey: "stage2-dag",
		sessionFile: null,
		cwd: "/tmp",
	});

	for (let i = 0; i < 20; i += 1) {
		store.insertMessage(conversation.conversationId, {
			entryId: `m-${i}`,
			role: i % 2 === 0 ? "user" : "assistant",
			contentText: `message-${i} ${"detail ".repeat(60)}`,
			contentJson: null,
			tokenEstimate: 120,
			createdAt: Date.now() + i,
		});
	}

	const before = store.getContextTokenEstimate(conversation.conversationId);
	assert.ok(before > 1800, `expected large initial token estimate, got ${before}`);

	const result = await runLcmCompaction(store, {
		conversationId: conversation.conversationId,
		targetTokens: 420,
		freshTailCount: 2,
		leafChunkTokens: 220,
		incrementalMaxDepth: 2,
	});

	assert.equal(result.compacted, true, "expected compaction to run");
	assert.ok(result.createdLeafCount > 0, "expected leaf summaries");
	assert.ok(result.createdCondensedCount > 0, "expected condensed summaries");

	const after = store.getContextTokenEstimate(conversation.conversationId);
	assert.ok(after < before, `expected token reduction (${before} -> ${after})`);
	assert.ok(after <= 700, `expected substantial reduction, got ${after}`);

	const context = store.listContextItems(conversation.conversationId);
	const messageIds = context.filter((item) => item.itemType === "message").map((item) => item.messageId);
	assert.deepEqual(messageIds, [19, 20], "expected fresh tail messages to remain raw in context");

	return conversation.conversationId;
}

async function runFallbackScenario(store, db) {
	const conversation = store.getOrCreateConversation({
		conversationKey: "stage2-fallback",
		sessionFile: null,
		cwd: "/tmp",
	});

	for (let i = 0; i < 4; i += 1) {
		store.insertMessage(conversation.conversationId, {
			entryId: `tiny-${i}`,
			role: "user",
			contentText: `m${i}`,
			contentJson: null,
			tokenEstimate: 2,
			createdAt: Date.now() + 1000 + i,
		});
	}

	await runLcmCompaction(store, {
		conversationId: conversation.conversationId,
		targetTokens: 1,
		freshTailCount: 1,
		leafChunkTokens: 100,
		incrementalMaxDepth: 1,
	});

	const fallbackRows = db
		.prepare(
			`SELECT summary_id, content
			 FROM summaries
			 WHERE conversation_id = ? AND content LIKE '%[lcm leaf fallback depth=0]%'`
		)
		.all(conversation.conversationId);
	assert.ok(fallbackRows.length >= 1, "expected deterministic fallback leaf summary");

	const firstId = String(fallbackRows[0].summary_id);
	await runLcmCompaction(store, {
		conversationId: conversation.conversationId,
		targetTokens: 1,
		freshTailCount: 1,
		leafChunkTokens: 100,
		incrementalMaxDepth: 1,
	});

	const repeated = db
		.prepare("SELECT COUNT(*) AS count FROM summaries WHERE conversation_id = ? AND summary_id = ?")
		.get(conversation.conversationId, firstId);
	assert.equal(Number(repeated.count), 1, "expected deterministic fallback summary id");
}

async function run() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-lcm-stage2-"));
	const dbPath = join(tempDir, "lcm.sqlite");

	try {
		const db = getLcmDb(dbPath);
		const store = new LcmStore(db);

		const primaryConversationId = await runPrimaryScenario(store);
		await runFallbackScenario(store, db);

		const summaryRows = db
			.prepare("SELECT COUNT(*) AS count FROM summaries WHERE conversation_id = ?")
			.get(primaryConversationId);
		assert.ok(Number(summaryRows.count) >= 2, "expected summary rows in primary scenario");

		const links = db
			.prepare(
				`SELECT COUNT(*) AS count
				 FROM summary_messages sm
				 JOIN summaries s ON s.summary_id = sm.summary_id
				 WHERE s.conversation_id = ?`
			)
			.get(primaryConversationId);
		assert.ok(Number(links.count) > 0, "expected summary->message links");

		const parentLinks = db
			.prepare(
				`SELECT COUNT(*) AS count
				 FROM summary_parents sp
				 JOIN summaries s ON s.summary_id = sp.summary_id
				 WHERE s.conversation_id = ?`
			)
			.get(primaryConversationId);
		assert.ok(Number(parentLinks.count) > 0, "expected summary parent links");

		console.log("LCM stage2 smoke test passed");
	} finally {
		closeAllLcmDbs();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

run();
