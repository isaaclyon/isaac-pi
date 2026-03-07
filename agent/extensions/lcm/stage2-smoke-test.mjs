import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runLcmCompaction } from "./compaction.ts";
import { closeAllLcmDbs, getLcmDb } from "./db.ts";
import { LcmStore } from "./store.ts";

function makeContent(seed, repeat = 60) {
	return `${seed} ${"detail ".repeat(repeat)}`;
}

function run() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-lcm-stage2-"));
	const dbPath = join(tempDir, "lcm.sqlite");

	try {
		const db = getLcmDb(dbPath);
		const store = new LcmStore(db);
		const conversation = store.getOrCreateConversation({
			conversationKey: "stage2-smoke",
			sessionFile: null,
			cwd: "/tmp",
		});

		for (let i = 0; i < 20; i += 1) {
			store.insertMessage(conversation.conversationId, {
				entryId: `m-${i}`,
				role: i % 2 === 0 ? "user" : "assistant",
				contentText: makeContent(`message-${i}`),
				contentJson: null,
				tokenEstimate: 120,
				createdAt: Date.now() + i,
			});
		}

		const before = store.getContextTokenEstimate(conversation.conversationId);
		assert.ok(before > 1800, `expected large initial token estimate, got ${before}`);

		const result = runLcmCompaction(store, {
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
		assert.ok(after <= 420, `expected final tokens to be under target, got ${after}`);

		const context = store.listContextItems(conversation.conversationId);
		const messageIds = context.filter((item) => item.itemType === "message").map((item) => item.messageId);
		assert.deepEqual(messageIds, [19, 20], "expected fresh tail messages to remain raw in context");

		const summaryRows = db.prepare("SELECT COUNT(*) AS count FROM summaries").get();
		assert.ok(Number(summaryRows.count) >= 2, "expected summary rows");

		const links = db.prepare("SELECT COUNT(*) AS count FROM summary_messages").get();
		assert.ok(Number(links.count) > 0, "expected summary->message links");

		const parentLinks = db.prepare("SELECT COUNT(*) AS count FROM summary_parents").get();
		assert.ok(Number(parentLinks.count) > 0, "expected summary parent links");

		console.log("LCM stage2 smoke test passed");
	} finally {
		closeAllLcmDbs();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

run();
