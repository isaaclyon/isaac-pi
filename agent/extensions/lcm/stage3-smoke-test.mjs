/**
 * Stage 3 smoke tests — Context assembly (TDD RED first)
 * Run: node --experimental-strip-types agent/extensions/lcm/stage3-smoke-test.mjs
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assembleContext } from "./assembly.ts";
import { runLcmCompaction } from "./compaction.ts";
import { closeAllLcmDbs, getLcmDb } from "./db.ts";
import { LcmStore } from "./store.ts";
import { toStoredMessage } from "./types.ts";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function makeConversation(store, key = "asm-test") {
	return store.getOrCreateConversation({ conversationKey: key, sessionFile: null, cwd: "/tmp" });
}

function insertMsg(store, conversationId, message, entryId = null) {
	return store.insertMessage(conversationId, toStoredMessage(message, entryId));
}

// ---------------------------------------------------------------------------
// test 1: empty context_items → empty array
// ---------------------------------------------------------------------------
function testEmptyContext(store) {
	const conv = makeConversation(store, "asm-empty");
	const result = assembleContext(store, conv.conversationId);
	assert.deepEqual(result, [], "empty context_items must return []");
}

// ---------------------------------------------------------------------------
// test 2: single user message — round-trips through toStoredMessage + assembly
// ---------------------------------------------------------------------------
function testUserMessageRoundtrip(store) {
	const conv = makeConversation(store, "asm-user");
	const original = {
		role: "user",
		content: [{ type: "text", text: "hello world" }],
		timestamp: 1700000000000,
	};
	insertMsg(store, conv.conversationId, original, "entry-u1");
	const result = assembleContext(store, conv.conversationId);
	assert.equal(result.length, 1, "expected 1 message");
	assert.equal(result[0].role, "user");
	assert.deepEqual(result[0].content, original.content);
}

// ---------------------------------------------------------------------------
// test 3: assistant message — role + content preserved
// ---------------------------------------------------------------------------
function testAssistantMessageRoundtrip(store) {
	const conv = makeConversation(store, "asm-asst");
	const original = {
		role: "assistant",
		content: [{ type: "text", text: "I can help with that." }],
		timestamp: 1700000001000,
		// extra fields that real AssistantMessage has but assembly doesn't need:
		api: "anthropic",
		provider: "anthropic",
		model: "claude-opus-4",
		usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "end_turn",
	};
	insertMsg(store, conv.conversationId, original, "entry-a1");
	const result = assembleContext(store, conv.conversationId);
	assert.equal(result.length, 1);
	assert.equal(result[0].role, "assistant");
	assert.deepEqual(result[0].content, original.content);
}

// ---------------------------------------------------------------------------
// test 4: toolResult message — toolCallId + isError preserved
// ---------------------------------------------------------------------------
function testToolResultMessageRoundtrip(store) {
	const conv = makeConversation(store, "asm-tool");
	const original = {
		role: "toolResult",
		toolCallId: "toolu_abc123",
		toolName: "bash",
		content: [{ type: "text", text: "output of the tool" }],
		isError: false,
		timestamp: 1700000002000,
	};
	insertMsg(store, conv.conversationId, original, "entry-t1");
	const result = assembleContext(store, conv.conversationId);
	assert.equal(result.length, 1);
	assert.equal(result[0].role, "toolResult");
	assert.equal(result[0].toolCallId, "toolu_abc123");
	assert.equal(result[0].isError, false);
	assert.deepEqual(result[0].content, original.content);
}

// ---------------------------------------------------------------------------
// test 5: summary item → synthetic user message with [LCM Summary] prefix
// ---------------------------------------------------------------------------
async function testSummaryInjection(store) {
	const conv = makeConversation(store, "asm-summary");

	// Insert enough messages to trigger compaction + create summaries
	for (let i = 0; i < 20; i++) {
		insertMsg(store, conv.conversationId, {
			role: i % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `message ${i} ${"word ".repeat(60)}` }],
			timestamp: 1700000000000 + i * 1000,
			...(i % 2 !== 0 ? {
				api: "anthropic", provider: "anthropic", model: "claude-opus-4",
				usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { input:0, output:0, cacheRead:0, cacheWrite:0, total:0 } },
				stopReason: "end_turn",
			} : {}),
		});
	}

	await runLcmCompaction(store, {
		conversationId: conv.conversationId,
		targetTokens: 300,
		freshTailCount: 2,
		leafChunkTokens: 200,
		incrementalMaxDepth: 2,
	});

	const items = store.listContextItems(conv.conversationId);
	const hasSummary = items.some((item) => item.itemType === "summary");
	assert.ok(hasSummary, "expected at least one summary context item after compaction");

	const result = assembleContext(store, conv.conversationId);
	assert.ok(result.length > 0, "assembled context must be non-empty after compaction");

	// Every summary item must produce a message with [LCM Summary] prefix in content text
	const summaryMessages = result.filter((msg) => {
		if (!Array.isArray(msg.content)) return false;
		return msg.content.some(
			(block) => typeof block === "object" && block.type === "text" && block.text.includes("[LCM Summary]"),
		);
	});
	assert.ok(summaryMessages.length > 0, "expected at least one summary injection message");
	const firstSummaryText = summaryMessages[0].content.find((block) => block.type === "text")?.text ?? "";
	assert.match(firstSummaryText, /\[LCM Summary\] id=lcm_\w+_\d+_[a-f0-9]+\b/, "summary injection should include a machine-readable summary id");
}

// ---------------------------------------------------------------------------
// test 6: mixed order — summaries before raw tail, ordinal preserved
// ---------------------------------------------------------------------------
async function testMixedOrderPreserved(store) {
	const conv = makeConversation(store, "asm-order");

	for (let i = 0; i < 12; i++) {
		insertMsg(store, conv.conversationId, {
			role: i % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `m${i} ${"ab ".repeat(55)}` }],
			timestamp: 1700000000000 + i * 1000,
			...(i % 2 !== 0 ? {
				api: "anthropic", provider: "anthropic", model: "claude-opus-4",
				usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { input:0, output:0, cacheRead:0, cacheWrite:0, total:0 } },
				stopReason: "end_turn",
			} : {}),
		});
	}

	await runLcmCompaction(store, {
		conversationId: conv.conversationId,
		targetTokens: 200,
		freshTailCount: 2,
		leafChunkTokens: 180,
		incrementalMaxDepth: 1,
	});

	const items = store.listContextItems(conv.conversationId);
	const result = assembleContext(store, conv.conversationId);

	// Result length must equal context_items length (1-to-1 mapping)
	assert.equal(result.length, items.length, "assembled message count must equal context_item count");

	// Raw tail messages (last 2 context_items that are 'message' type) must be at the end
	const tailItems = items.filter((item) => item.itemType === "message");
	if (tailItems.length > 0) {
		const lastItem = items[items.length - 1];
		const lastMsg = result[result.length - 1];
		if (lastItem.itemType === "message") {
			assert.ok(lastMsg.role === "user" || lastMsg.role === "assistant" || lastMsg.role === "toolResult",
				"last assembled message should be a raw message type");
		}
	}
}

// ---------------------------------------------------------------------------
// test 7: corrupt/null contentJson falls back gracefully (no throw)
// ---------------------------------------------------------------------------
function testCorruptContentJsonFallback(store, db) {
	const conv = makeConversation(store, "asm-corrupt");
	// Insert a valid message first
	insertMsg(store, conv.conversationId, {
		role: "user",
		content: [{ type: "text", text: "fallback test" }],
		timestamp: 1700000000000,
	});

	// Corrupt the contentJson directly in DB
	db.prepare("UPDATE messages SET content_json = 'not-valid-json{{{' WHERE conversation_id = ?")
		.run(conv.conversationId);

	// Must not throw — should fall back to a synthetic user message from contentText
	let result;
	assert.doesNotThrow(() => {
		result = assembleContext(store, conv.conversationId);
	}, "assembleContext must not throw on corrupt contentJson");

	assert.equal(result.length, 1, "fallback should still produce a message");
	assert.equal(result[0].role, "user", "fallback message should be user role");
}

// ---------------------------------------------------------------------------
// run all
// ---------------------------------------------------------------------------
async function run() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-lcm-stage3-"));
	const dbPath = join(tempDir, "lcm.sqlite");
	try {
		const db = getLcmDb(dbPath);
		const store = new LcmStore(db);

		testEmptyContext(store);
		console.log("  ✓ empty context → []");

		testUserMessageRoundtrip(store);
		console.log("  ✓ user message round-trips through assembly");

		testAssistantMessageRoundtrip(store);
		console.log("  ✓ assistant message round-trips through assembly");

		testToolResultMessageRoundtrip(store);
		console.log("  ✓ toolResult message preserves toolCallId + isError");

		await testSummaryInjection(store);
		console.log("  ✓ summary context items → synthetic [LCM Summary] user message");

		await testMixedOrderPreserved(store);
		console.log("  ✓ mixed summary + raw messages preserve ordinal order");

		testCorruptContentJsonFallback(store, db);
		console.log("  ✓ corrupt contentJson falls back gracefully (no throw)");

		console.log("\nLCM stage3 smoke test passed");
	} finally {
		closeAllLcmDbs();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

run();
