/**
 * P0 LLM Summarizer — TDD test suite
 *
 * Run: node --experimental-strip-types agent/extensions/lcm/p0-llm-summarizer-test.mjs
 *
 * All tests must FAIL before any implementation exists.
 * After implementation, all tests must PASS.
 */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runLcmCompaction } from "./compaction.ts";
import { createLlmSummarizer } from "./summarizer.ts";
import { closeAllLcmDbs, getLcmDb } from "./db.ts";
import { LcmStore } from "./store.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpStore(label) {
	const dir = mkdtempSync(join(tmpdir(), `lcm-p0-${label}-`));
	const db = getLcmDb(join(dir, "lcm.db"));
	const store = new LcmStore(db);
	return { store, dir };
}

function insertMessages(store, conversationId, count, tokensEach = 120) {
	for (let i = 0; i < count; i++) {
		store.insertMessage(conversationId, {
			entryId: `m-${i}`,
			role: i % 2 === 0 ? "user" : "assistant",
			contentText: `message-${i} ${"detail ".repeat(30)}`,
			contentJson: null,
			tokenEstimate: tokensEach,
			createdAt: Date.now() + i,
		});
	}
}

function makeConversation(store, key = "test") {
	return store.getOrCreateConversation({ conversationKey: key, sessionFile: null, cwd: "/tmp" });
}

/**
 * Minimal mock that satisfies AssistantMessageEventStream.result() shape.
 * Returns an object with `.result()` resolving to a mock AssistantMessage.
 */
function mockStreamSimple(responseText) {
	return (_model, _context) => ({
		result: () =>
			Promise.resolve({
				role: "assistant",
				content: [{ type: "text", text: responseText }],
				api: "mock",
				provider: "mock",
				model: "mock",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "stop",
				timestamp: Date.now(),
			}),
	});
}

function mockStreamSimpleError() {
	return (_model, _context) => ({
		result: () => Promise.reject(new Error("stream failure")),
	});
}

const MOCK_MODEL = { api: "mock", id: "mock-model" };

// ---------------------------------------------------------------------------
// Test 1: runLcmCompaction returns a Promise when given an async summarizer
// ---------------------------------------------------------------------------

async function test_compaction_returns_promise() {
	const { store, dir } = makeTmpStore("promise");
	try {
		const conversation = makeConversation(store, "promise-test");
		insertMessages(store, conversation.conversationId, 10);

		const asyncSummarizer = async (input) => `summarized: ${input.slice(0, 10)}`;

		const returnValue = runLcmCompaction(store, {
			conversationId: conversation.conversationId,
			targetTokens: 100,
			freshTailCount: 2,
			leafChunkTokens: 300,
			incrementalMaxDepth: 2,
			summarizer: asyncSummarizer,
		});

		assert.ok(
			returnValue instanceof Promise,
			`expected runLcmCompaction to return a Promise, got ${Object.prototype.toString.call(returnValue)}`,
		);

		await returnValue; // must resolve without throwing
		console.log("PASS test_compaction_returns_promise");
	} finally {
		closeAllLcmDbs();
		rmSync(dir, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// Test 2: leaf summary uses summarizer output
// ---------------------------------------------------------------------------

async function test_leaf_summary_uses_summarizer_output() {
	const { store, dir } = makeTmpStore("leaf-summarizer");
	try {
		const conversation = makeConversation(store, "leaf-summarizer-test");
		insertMessages(store, conversation.conversationId, 10);

		const SENTINEL = "SEMANTIC_LEAF_SUMMARY_SENTINEL";
		const summarizer = async (_input) => SENTINEL;

		const result = await runLcmCompaction(store, {
			conversationId: conversation.conversationId,
			targetTokens: 100,
			freshTailCount: 2,
			leafChunkTokens: 300,
			incrementalMaxDepth: 2,
			summarizer,
		});

		assert.ok(result.compacted, "expected compaction to run");
		assert.ok(result.createdLeafCount > 0, "expected leaf summaries to be created");

		// Verify the leaf summary content is the summarizer output
		const items = store.listContextItems(conversation.conversationId);
		const summaryIds = items
			.filter((item) => item.itemType === "summary" && item.summaryId !== null)
			.map((item) => item.summaryId);
		assert.ok(summaryIds.length > 0, "expected summary items in context");

		const summaries = store.getSummaryRows(summaryIds);
		const leafSummaries = summaries.filter((s) => s.summaryId.startsWith("lcm_leaf_"));
		assert.ok(leafSummaries.length > 0, "expected leaf summaries");
		for (const leaf of leafSummaries) {
			assert.equal(
				leaf.content,
				SENTINEL,
				`expected leaf content to be summarizer output, got: ${leaf.content}`,
			);
		}
		console.log("PASS test_leaf_summary_uses_summarizer_output");
	} finally {
		closeAllLcmDbs();
		rmSync(dir, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// Test 3: without summarizer, leaf summary uses structural format
// ---------------------------------------------------------------------------

async function test_leaf_summary_without_summarizer_uses_structural_format() {
	const { store, dir } = makeTmpStore("leaf-structural");
	try {
		const conversation = makeConversation(store, "leaf-structural-test");
		insertMessages(store, conversation.conversationId, 10);

		const result = await runLcmCompaction(store, {
			conversationId: conversation.conversationId,
			targetTokens: 100,
			freshTailCount: 2,
			leafChunkTokens: 300,
			incrementalMaxDepth: 2,
			// no summarizer
		});

		assert.ok(result.compacted, "expected compaction to run");

		const items = store.listContextItems(conversation.conversationId);
		const summaryIds = items
			.filter((item) => item.itemType === "summary" && item.summaryId !== null)
			.map((item) => item.summaryId);
		const summaries = store.getSummaryRows(summaryIds);
		const leafSummaries = summaries.filter((s) => s.summaryId.startsWith("lcm_leaf_"));
		assert.ok(leafSummaries.length > 0, "expected leaf summaries");
		for (const leaf of leafSummaries) {
			assert.ok(
				leaf.content.includes("[lcm leaf"),
				`expected structural format in leaf content, got: ${leaf.content.slice(0, 80)}`,
			);
		}
		console.log("PASS test_leaf_summary_without_summarizer_uses_structural_format");
	} finally {
		closeAllLcmDbs();
		rmSync(dir, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// Test 4: condensed summary uses summarizer output
// ---------------------------------------------------------------------------

async function test_condensed_summary_uses_summarizer_output() {
	const { store, dir } = makeTmpStore("condensed-summarizer");
	try {
		const conversation = makeConversation(store, "condensed-summarizer-test");
		// Need enough messages to trigger condensed pass
		insertMessages(store, conversation.conversationId, 30);

		const SENTINEL = "SEMANTIC_CONDENSED_SUMMARY_SENTINEL";
		const summarizer = async (_input) => SENTINEL;

		const result = await runLcmCompaction(store, {
			conversationId: conversation.conversationId,
			targetTokens: 100,
			freshTailCount: 2,
			leafChunkTokens: 220,
			incrementalMaxDepth: 2,
			summarizer,
		});

		assert.ok(result.compacted, "expected compaction to run");
		assert.ok(result.createdCondensedCount > 0, "expected condensed summaries to be created");

		const items = store.listContextItems(conversation.conversationId);
		const summaryIds = items
			.filter((item) => item.itemType === "summary" && item.summaryId !== null)
			.map((item) => item.summaryId);
		const summaries = store.getSummaryRows(summaryIds);
		const condensedSummaries = summaries.filter((s) => s.summaryId.startsWith("lcm_condensed_"));
		assert.ok(condensedSummaries.length > 0, "expected condensed summaries");
		for (const condensed of condensedSummaries) {
			assert.equal(
				condensed.content,
				SENTINEL,
				`expected condensed content to be summarizer output, got: ${condensed.content}`,
			);
		}
		console.log("PASS test_condensed_summary_uses_summarizer_output");
	} finally {
		closeAllLcmDbs();
		rmSync(dir, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// Test 5: createLlmSummarizer returns text from assistant message
// ---------------------------------------------------------------------------

async function test_createLlmSummarizer_returns_assistant_text() {
	const streamSimple = mockStreamSimple("hello from LLM");
	const summarizer = createLlmSummarizer(streamSimple, MOCK_MODEL);

	const result = await summarizer("some structural input");
	assert.equal(result, "hello from LLM", `expected 'hello from LLM', got '${result}'`);
	console.log("PASS test_createLlmSummarizer_returns_assistant_text");
}

// ---------------------------------------------------------------------------
// Test 6: createLlmSummarizer passes input as user message content to streamSimple
// ---------------------------------------------------------------------------

async function test_createLlmSummarizer_passes_input_as_user_message() {
	let capturedContext = null;
	let capturedModel = null;

	const capturingStreamSimple = (model, context) => {
		capturedModel = model;
		capturedContext = context;
		return {
			result: () =>
				Promise.resolve({
					role: "assistant",
					content: [{ type: "text", text: "ok" }],
				}),
		};
	};

	const summarizer = createLlmSummarizer(capturingStreamSimple, MOCK_MODEL);
	const input = "structural summary text here";
	await summarizer(input);

	assert.deepEqual(capturedModel, MOCK_MODEL, "expected model to be passed through");
	assert.ok(capturedContext, "expected context to be captured");
	assert.ok(Array.isArray(capturedContext.messages), "expected messages array in context");
	assert.ok(capturedContext.messages.length > 0, "expected at least one message");

	// The user message should contain the input text somewhere
	const userMessages = capturedContext.messages.filter((m) => m.role === "user");
	assert.ok(userMessages.length > 0, "expected at least one user message");
	const userContent = JSON.stringify(userMessages[0].content);
	assert.ok(
		userContent.includes(input),
		`expected user message to contain input text, got: ${userContent.slice(0, 200)}`,
	);
	console.log("PASS test_createLlmSummarizer_passes_input_as_user_message");
}

// ---------------------------------------------------------------------------
// Test 7: createLlmSummarizer falls back to structural input on stream error
// ---------------------------------------------------------------------------

async function test_createLlmSummarizer_falls_back_on_error() {
	const streamSimple = mockStreamSimpleError();
	const summarizer = createLlmSummarizer(streamSimple, MOCK_MODEL);

	const input = "fallback test input";
	const result = await summarizer(input);
	assert.equal(result, input, `expected fallback to input on error, got '${result}'`);
	console.log("PASS test_createLlmSummarizer_falls_back_on_error");
}

// ---------------------------------------------------------------------------
// Test 8: summarizer is called once per leaf chunk (not batched across chunks)
// ---------------------------------------------------------------------------

async function test_summarizer_called_once_per_leaf_chunk() {
	const { store, dir } = makeTmpStore("call-count");
	try {
		const conversation = makeConversation(store, "call-count-test");
		insertMessages(store, conversation.conversationId, 20);

		let callCount = 0;
		const countingSummarizer = async (input) => {
			callCount++;
			return `summary-${callCount}`;
		};

		const result = await runLcmCompaction(store, {
			conversationId: conversation.conversationId,
			targetTokens: 100,
			freshTailCount: 2,
			leafChunkTokens: 300,
			incrementalMaxDepth: 2,
			summarizer: countingSummarizer,
		});

		assert.ok(result.createdLeafCount > 0, "expected leaf summaries");
		assert.equal(
			callCount,
			result.createdLeafCount + result.createdCondensedCount,
			`expected summarizer called once per created summary (leaf+condensed), got ${callCount} calls for ${result.createdLeafCount} leaf + ${result.createdCondensedCount} condensed`,
		);
		console.log("PASS test_summarizer_called_once_per_leaf_chunk");
	} finally {
		closeAllLcmDbs();
		rmSync(dir, { recursive: true });
	}
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function runAll() {
	const tests = [
		test_compaction_returns_promise,
		test_leaf_summary_uses_summarizer_output,
		test_leaf_summary_without_summarizer_uses_structural_format,
		test_condensed_summary_uses_summarizer_output,
		test_createLlmSummarizer_returns_assistant_text,
		test_createLlmSummarizer_passes_input_as_user_message,
		test_createLlmSummarizer_falls_back_on_error,
		test_summarizer_called_once_per_leaf_chunk,
	];

	let passed = 0;
	let failed = 0;

	for (const test of tests) {
		try {
			await test();
			passed++;
		} catch (err) {
			console.error(`FAIL ${test.name}: ${err.message}`);
			failed++;
		}
	}

	console.log(`\n${passed} passed, ${failed} failed`);
	if (failed > 0) {
		process.exit(1);
	}
}

runAll();
