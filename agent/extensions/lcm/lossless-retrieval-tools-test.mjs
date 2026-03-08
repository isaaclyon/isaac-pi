import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { assembleContext } from "./assembly.ts";
import { closeAllLcmDbs, getLcmDb } from "./db.ts";
import { lcmToolSchemas, registerLcmRetrievalTools } from "./retrieval-tools.ts";
import { LcmStore } from "./store.ts";
import { toStoredMessage } from "./types.ts";

function makeConversation(store, key = "lossless") {
	return store.getOrCreateConversation({ conversationKey: key, sessionFile: null, cwd: "/tmp" });
}

function insertMsg(store, conversationId, text, role = "user", timestamp = Date.now()) {
	const result = store.insertMessage(
		conversationId,
		toStoredMessage(
			{
				role,
				content: [{ type: "text", text }],
				timestamp,
				...(role === "assistant"
					? {
							api: "anthropic",
							provider: "anthropic",
							model: "claude-opus-4",
							usage: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
							},
							stopReason: "end_turn",
					  }
					: {}),
			},
			null,
		),
	);
	assert.equal(result.inserted, true, "message insert must succeed in fixture setup");
	return result.messageId;
}

function seedSummaryGraph(store, conversationId) {
	const baseTs = 1700000000000;
	const m1 = insertMsg(store, conversationId, "alpha earliest anchor", "user", baseTs + 1000);
	const m2 = insertMsg(store, conversationId, "beta middle detail", "assistant", baseTs + 2000);
	const m3 = insertMsg(store, conversationId, "alpha later finding", "user", baseTs + 3000);
	const m4 = insertMsg(store, conversationId, "delta final handoff", "assistant", baseTs + 4000);

	const s1 = `lcm_leaf_0_s1_${conversationId}`;
	const s2 = `lcm_leaf_0_s2_${conversationId}`;
	const s3 = `lcm_condensed_1_s3_${conversationId}`;

	store.upsertSummary({
		summaryId: s1,
		conversationId,
		depth: 0,
		kind: "leaf",
		content: "summary s1",
		tokenEstimate: 10,
		earliestAt: baseTs + 1000,
		latestAt: baseTs + 2000,
		createdAt: baseTs + 5000,
	});
	store.setSummaryMessages(s1, [m1, m2]);
	store.setSummaryParents(s1, []);

	store.upsertSummary({
		summaryId: s2,
		conversationId,
		depth: 0,
		kind: "leaf",
		content: "summary s2",
		tokenEstimate: 11,
		earliestAt: baseTs + 3000,
		latestAt: baseTs + 4000,
		createdAt: baseTs + 6000,
	});
	store.setSummaryMessages(s2, [m3, m4]);
	store.setSummaryParents(s2, []);

	store.upsertSummary({
		summaryId: s3,
		conversationId,
		depth: 1,
		kind: "condensed",
		content: "summary s3",
		tokenEstimate: 12,
		earliestAt: baseTs + 1000,
		latestAt: baseTs + 4000,
		createdAt: baseTs + 7000,
	});
	store.setSummaryMessages(s3, []);
	store.setSummaryParents(s3, [s1, s2]);

	return { messageIds: [m1, m2, m3, m4], summaryIds: { s1, s2, s3 }, baseTs };
}

function getText(result) {
	const first = result?.content?.[0];
	if (!first || first.type !== "text") return "";
	return first.text;
}

function makeCtx({ parentSession } = {}) {
	return {
		hasUI: false,
		cwd: "/tmp",
		sessionManager: {
			getHeader() {
				return {
					type: "session",
					id: "session-test",
					timestamp: new Date().toISOString(),
					cwd: "/tmp",
					parentSession,
				};
			},
		},
	};
}

async function testStoreRetrievalPrimitives(store) {
	const conv = makeConversation(store, "store-primitives");
	const { messageIds, summaryIds } = seedSummaryGraph(store, conv.conversationId);

	const summary = store.getSummaryWithProvenance(conv.conversationId, summaryIds.s1);
	assert.ok(summary, "summary describe lookup must return a row");
	assert.equal(summary.summaryId, summaryIds.s1);
	assert.deepEqual(summary.parentSummaryIds, []);
	assert.deepEqual(summary.directMessageIds, [messageIds[0], messageIds[1]]);

	const expanded = store.expandSummaryMessages(conv.conversationId, summaryIds.s3);
	assert.deepEqual(
		expanded.map((m) => m.messageId),
		messageIds,
		"expansion should recursively return ordered source messages",
	);

	const globalMatches = store.searchMessages(conv.conversationId, "alpha");
	assert.deepEqual(
		globalMatches.map((m) => m.messageId),
		[messageIds[0], messageIds[2]],
		"global grep should find all matching messages",
	);

	const scopedMatches = store.searchMessages(conv.conversationId, "alpha", [messageIds[0], messageIds[1]]);
	assert.deepEqual(
		scopedMatches.map((m) => m.messageId),
		[messageIds[0]],
		"scoped grep should only search message ids tied to requested summary",
	);
}

async function testAssemblySummaryIds(store) {
	const conv = makeConversation(store, "assembly-summary-id");
	const { summaryIds, baseTs } = seedSummaryGraph(store, conv.conversationId);

	store.setContextItems(conv.conversationId, [
		{
			itemType: "summary",
			messageId: null,
			summaryId: summaryIds.s1,
			createdAt: baseTs + 8000,
		},
	]);

	const assembled = assembleContext(store, conv.conversationId);
	assert.equal(assembled.length, 1);
	const text = assembled[0].content?.[0]?.text ?? "";
	assert.match(text, new RegExp(`\\[LCM Summary\\] id=${summaryIds.s1}\\b`), "summary injection should include machine-readable summary id");
}

async function testExtensionWiresRetrievalTools() {
	const { readFileSync } = await import("node:fs");
	const { fileURLToPath } = await import("node:url");
	const { dirname, join } = await import("node:path");
	const dir = dirname(fileURLToPath(import.meta.url));
	const indexSrc = readFileSync(join(dir, "index.ts"), "utf8");
	const toolSrc = readFileSync(join(dir, "retrieval-tools.ts"), "utf8");

	assert.match(indexSrc, /registerLcmRetrievalTools\(/, "index.ts must register retrieval tools");
	assert.match(toolSrc, /name:\s*"lcm_describe"/, "retrieval tool implementation should define lcm_describe");
	assert.match(toolSrc, /name:\s*"lcm_grep"/, "retrieval tool implementation should define lcm_grep");
	assert.match(toolSrc, /name:\s*"lcm_expand"/, "retrieval tool implementation should define lcm_expand");
}

async function testToolRegistrationAndBehavior(store) {
	const conv = makeConversation(store, "tool-behavior");
	const { messageIds, summaryIds } = seedSummaryGraph(store, conv.conversationId);

	const registeredTools = [];
	registerLcmRetrievalTools(
		{
			registerTool(tool) {
				registeredTools.push(tool);
			},
		},
		() => ({ enabled: true, store, conversationId: conv.conversationId }),
	);

	const names = registeredTools.map((tool) => tool.name).sort();
	assert.deepEqual(names, ["lcm_describe", "lcm_expand", "lcm_grep"], "all retrieval tools must be registered");
	assert.ok(lcmToolSchemas.lcm_describe, "schemas should expose describe contract");
	assert.ok(lcmToolSchemas.lcm_grep, "schemas should expose grep contract");
	assert.ok(lcmToolSchemas.lcm_expand, "schemas should expose expand contract");

	const describeTool = registeredTools.find((tool) => tool.name === "lcm_describe");
	const grepTool = registeredTools.find((tool) => tool.name === "lcm_grep");
	const expandTool = registeredTools.find((tool) => tool.name === "lcm_expand");
	assert.ok(describeTool);
	assert.ok(grepTool);
	assert.ok(expandTool);

	const describeUnknown = await describeTool.execute("call-1", { id: "./src/file.ts" }, undefined, undefined, makeCtx());
	assert.equal(describeUnknown.isError, true, "file-like ids should fail with guidance");
	assert.match(getText(describeUnknown), /summary id/i);

	const describeResult = await describeTool.execute(
		"call-2",
		{ id: summaryIds.s1 },
		undefined,
		undefined,
		makeCtx(),
	);
	assert.equal(describeResult.isError, false);
	assert.equal(describeResult.details.summary.summaryId, summaryIds.s1);

	const grepGlobal = await grepTool.execute("call-3", { pattern: "alpha" }, undefined, undefined, makeCtx());
	assert.equal(grepGlobal.isError, false);
	assert.deepEqual(
		grepGlobal.details.matches.map((m) => m.messageId),
		[messageIds[0], messageIds[2]],
		"lcm_grep should return global matches in sequence order",
	);

	const grepScoped = await grepTool.execute(
		"call-4",
		{ pattern: "alpha", summary_id: summaryIds.s1 },
		undefined,
		undefined,
		makeCtx(),
	);
	assert.equal(grepScoped.isError, false);
	assert.deepEqual(
		grepScoped.details.matches.map((m) => m.messageId),
		[messageIds[0]],
		"lcm_grep should scope matches to summary ancestry",
	);

	const expandDenied = await expandTool.execute(
		"call-5",
		{ summary_id: summaryIds.s3 },
		undefined,
		undefined,
		makeCtx(),
	);
	assert.equal(expandDenied.isError, true, "root agent context should be blocked for lcm_expand");
	assert.match(getText(expandDenied), /sub-agent/i);

	const expandAllowed = await expandTool.execute(
		"call-6",
		{ summary_id: summaryIds.s3 },
		undefined,
		undefined,
		makeCtx({ parentSession: "/tmp/parent-session.jsonl" }),
	);
	assert.equal(expandAllowed.isError, false);
	assert.deepEqual(
		expandAllowed.details.messages.map((m) => m.messageId),
		messageIds,
		"lcm_expand should return ordered source messages",
	);
}

async function run() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-lcm-lossless-"));
	const dbPath = join(tempDir, "lcm.sqlite");
	try {
		const db = getLcmDb(dbPath);
		const store = new LcmStore(db);

		testExtensionWiresRetrievalTools();
		console.log("  ✓ index.ts wires retrieval tool registration");

		await testStoreRetrievalPrimitives(store);
		console.log("  ✓ store retrieval primitives (describe/grep/expand) behave deterministically");

		await testAssemblySummaryIds(store);
		console.log("  ✓ assembleContext includes machine-readable summary ids");

		await testToolRegistrationAndBehavior(store);
		console.log("  ✓ retrieval tools register, enforce access control, and return scoped results");

		console.log("\nLCM lossless retrieval tools test passed");
	} finally {
		closeAllLcmDbs();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

run().catch((error) => {
	console.error(error);
	process.exit(1);
});
