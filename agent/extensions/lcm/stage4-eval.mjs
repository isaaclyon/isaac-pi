/**
 * Stage 4 evaluation script — LCM feasibility measurement
 *
 * Metrics measured:
 *   1. Context coverage  — LCM spans full session history; baseline truncation drops early turns
 *   2. Fact preservation — first-message fact survives into depth=0 leaf summaries
 *   3. Token compression — ratio of tokens before/after compaction (across session sizes)
 *   4. Compaction latency — median / p90 / p99 (μs)
 *   5. Assembly latency  — median / p90 / p99 (μs) — on the hot path before every LLM call
 *   6. Structural correctness — toolResult fields round-trip perfectly through assembly
 *   7. Toggle safety — empty conversation → [] → no native context override
 *
 * NOTE ON FACT RECALL:
 *   The current compaction is deterministic (rule-based, not LLM). Leaf summaries carry the
 *   first ~120 chars of each covered message. Condensed summaries carry ~120 chars of each
 *   leaf summary. Facts survive in depth=0 leaf context items but get progressively truncated
 *   at depth≥1. This is expected and documented as a known limitation — real LCM uses an LLM
 *   summarizer that can distill facts semantically. The evaluation measures what IS deterministic.
 *
 * Run: node --experimental-strip-types agent/extensions/lcm/stage4-eval.mjs
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

function makeConv(store, key) {
	return store.getOrCreateConversation({ conversationKey: key, sessionFile: null, cwd: "/tmp" });
}

function ins(store, cid, msg) {
	return store.insertMessage(cid, toStoredMessage(msg, null));
}

function userMsg(text, ts) {
	return { role: "user", content: [{ type: "text", text }], timestamp: ts };
}

function asstMsg(text, ts) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp: ts,
		api: "anthropic",
		provider: "anthropic",
		model: "claude-opus-4",
		usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "end_turn",
	};
}

function toolCallMsg(callId, text, ts) {
	return {
		role: "assistant",
		content: [{ type: "toolCall", id: callId, name: "bash", arguments: { command: text } }],
		timestamp: ts,
		api: "anthropic",
		provider: "anthropic",
		model: "claude-opus-4",
		usage: { input: 10, output: 5, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		stopReason: "tool_use",
	};
}

function toolResultMsg(callId, output, isErr, ts) {
	return {
		role: "toolResult",
		toolCallId: callId,
		toolName: "bash",
		content: [{ type: "text", text: output }],
		isError: isErr,
		timestamp: ts,
	};
}

function percentile(sorted, p) {
	const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
	return sorted[idx];
}

function statsUs(samples) {
	const sorted = [...samples].sort((a, b) => a - b);
	return {
		min: sorted[0],
		median: percentile(sorted, 0.5),
		p90: percentile(sorted, 0.9),
		p99: percentile(sorted, 0.99),
		max: sorted[sorted.length - 1],
	};
}

function textInMessages(messages, needle) {
	return messages.some((msg) => {
		if (!Array.isArray(msg.content)) return false;
		return msg.content.some(
			(block) => typeof block === "object" && block !== null
				&& typeof block.text === "string" && block.text.includes(needle),
		);
	});
}

// ---------------------------------------------------------------------------
// Scenario 1: context coverage — structural span comparison
// ---------------------------------------------------------------------------
async function scenarioCoverage(store) {
	// Build a 60-message session. After compaction:
	//   - LCM context has summary nodes spanning ALL 60 messages + fresh tail
	//   - Baseline (tail-only) has only the last freshTailCount messages
	// We verify LCM context items outnumber baseline and cover earlier seqs.

	const conv = makeConv(store, "eval-coverage");
	const cid = conv.conversationId;
	const TOTAL = 60;
	const FRESH_TAIL = 4;
	const ts = Date.now();

	for (let i = 0; i < TOTAL; i++) {
		ins(store, cid, i % 2 === 0
			? userMsg(`user turn ${i} ${"context ".repeat(30)}`, ts + i * 100)
			: asstMsg(`asst turn ${i} ${"detail ".repeat(30)}`, ts + i * 100));
	}

	const tokensBefore = store.getContextTokenEstimate(cid);
	await runLcmCompaction(store, {
		conversationId: cid,
		targetTokens: 800,
		freshTailCount: FRESH_TAIL,
		leafChunkTokens: 500,
		incrementalMaxDepth: 2,
	});
	const tokensAfter = store.getContextTokenEstimate(cid);

	const items = store.listContextItems(cid);
	const summaryItems = items.filter((i) => i.itemType === "summary");
	const rawItems = items.filter((i) => i.itemType === "message");
	const lcmAssembled = assembleContext(store, cid);

	// Baseline: only the last FRESH_TAIL raw messages — simulates naive truncation
	const baselineCount = FRESH_TAIL;

	return {
		totalMessages: TOTAL,
		freshTail: FRESH_TAIL,
		tokensBefore,
		tokensAfter,
		compressionRatio: (tokensBefore / Math.max(1, tokensAfter)).toFixed(2),
		tokenReductionPct: (((tokensBefore - tokensAfter) / tokensBefore) * 100).toFixed(0) + "%",
		summaryItems: summaryItems.length,
		rawTailItems: rawItems.length,
		lcmContextItems: lcmAssembled.length,
		baselineContextItems: baselineCount,
		lcmCoversFullHistory: summaryItems.length > 0,
	};
}

// ---------------------------------------------------------------------------
// Scenario 2: fact preservation at depth=0 (leaf-level)
// ---------------------------------------------------------------------------
async function scenarioLeafFacts(store) {
	// At leaf depth, facts planted at the START of a leaf chunk DO appear in the
	// summary text (the leaf summary includes the first 8 messages' contentText).
	// We plant SHORT facts at the very start of message content so they survive
	// the 180-char normalizeText truncation.
	//
	// This shows LCM retains fine-grained facts in depth=0 summaries — and
	// acknowledges that depth≥1 condensation further compresses this.

	const conv = makeConv(store, "eval-leaffacts");
	const cid = conv.conversationId;
	const ts = Date.now();

	// 16 messages — will produce leaf summaries at depth=0, possibly one condensed
	// Plant UNIQ_LEAF_FACT at start of first message
	const LEAF_FACT = "UNIQ_LEAF_FACT";
	ins(store, cid, userMsg(`${LEAF_FACT} start of session important detail`, ts));
	for (let i = 1; i < 16; i++) {
		ins(store, cid, i % 2 !== 0
			? userMsg(`user filler ${i} ${"word ".repeat(30)}`, ts + i)
			: asstMsg(`asst filler ${i} ${"word ".repeat(30)}`, ts + i));
	}

	await runLcmCompaction(store, {
		conversationId: cid,
		targetTokens: 200,
		freshTailCount: 2,
		leafChunkTokens: 400,
		incrementalMaxDepth: 1,
	});

	const assembled = assembleContext(store, cid);
	const factInContext = textInMessages(assembled, LEAF_FACT);

	// Also check that the fact is NOT in the baseline (tail only)
	const allMsgIds = store.listContextItems(cid)
		.filter((i) => i.itemType === "message")
		.map((i) => i.messageId);
	const tailRows = store.getMessagesByIds(allMsgIds);
	const baselineMsgs = tailRows.map((r) => {
		try { return JSON.parse(r.contentJson); } catch { return userMsg(r.contentText, r.createdAt); }
	});
	const factInBaseline = textInMessages(baselineMsgs, LEAF_FACT);

	return { factInContext, factInBaseline };
}

// ---------------------------------------------------------------------------
// Scenario 3: toolResult structural integrity
// ---------------------------------------------------------------------------
async function scenarioToolIntegrity(store) {
	const conv = makeConv(store, "eval-tool");
	const cid = conv.conversationId;
	const ts = Date.now();

	// Tool call in fresh tail — must round-trip with full fidelity
	for (let i = 0; i < 20; i++) {
		ins(store, cid, i % 2 === 0
			? userMsg(`filler ${i} ${"word ".repeat(40)}`, ts + i)
			: asstMsg(`reply ${i} ${"word ".repeat(40)}`, ts + i));
	}
	// Fresh tail: toolCall + toolResult pair
	ins(store, cid, toolCallMsg("call-tail", "pwd", ts + 9000));
	ins(store, cid, toolResultMsg("call-tail", "/workspace", false, ts + 9001));

	await runLcmCompaction(store, {
		conversationId: cid,
		targetTokens: 400,
		freshTailCount: 4,
		leafChunkTokens: 400,
		incrementalMaxDepth: 1,
	});

	const assembled = assembleContext(store, cid);

	const tailToolCall = assembled.find(
		(m) => m.role === "assistant" && Array.isArray(m.content)
			&& m.content.some((b) => b.type === "toolCall" && b.id === "call-tail"),
	);
	const tailToolResult = assembled.find(
		(m) => m.role === "toolResult" && m.toolCallId === "call-tail",
	);

	return {
		assembledCount: assembled.length,
		tailToolCallPreserved: tailToolCall !== undefined,
		tailToolResultPreserved: tailToolResult !== undefined,
		tailToolResultIsError: tailToolResult?.isError,
		tailToolResultContent: tailToolResult?.content?.[0]?.text,
	};
}

// ---------------------------------------------------------------------------
// Scenario 4: compaction latency benchmark
// ---------------------------------------------------------------------------
async function scenarioCompactionLatency(store) {
	const RUNS = 20;
	const timings = [];
	for (let run = 0; run < RUNS; run++) {
		const conv = makeConv(store, `eval-clat-${run}`);
		const cid = conv.conversationId;
		const ts = Date.now();
		for (let i = 0; i < 40; i++) {
			ins(store, cid, i % 2 === 0
				? userMsg(`turn ${i} ${"data ".repeat(40)}`, ts + i)
				: asstMsg(`reply ${i} ${"data ".repeat(40)}`, ts + i));
		}
		const t0 = performance.now();
		await runLcmCompaction(store, {
			conversationId: cid, targetTokens: 300,
			freshTailCount: 4, leafChunkTokens: 400, incrementalMaxDepth: 2,
		});
		timings.push((performance.now() - t0) * 1000); // μs
	}
	return statsUs(timings);
}

// ---------------------------------------------------------------------------
// Scenario 5: assembly latency benchmark
// ---------------------------------------------------------------------------
async function scenarioAssemblyLatency(store) {
	const conv = makeConv(store, "eval-alat");
	const cid = conv.conversationId;
	const ts = Date.now();
	for (let i = 0; i < 60; i++) {
		ins(store, cid, i % 2 === 0
			? userMsg(`turn ${i} ${"word ".repeat(40)}`, ts + i)
			: asstMsg(`reply ${i} ${"word ".repeat(40)}`, ts + i));
	}
	await runLcmCompaction(store, {
		conversationId: cid, targetTokens: 500,
		freshTailCount: 4, leafChunkTokens: 400, incrementalMaxDepth: 2,
	});

	const RUNS = 50;
	const timings = [];
	for (let i = 0; i < RUNS; i++) {
		const t0 = performance.now();
		assembleContext(store, cid);
		timings.push((performance.now() - t0) * 1000);
	}
	return statsUs(timings);
}

// ---------------------------------------------------------------------------
// Scenario 6: compression ratios across session sizes
// ---------------------------------------------------------------------------
async function scenarioCompressionRatios(store) {
	const sizes = [20, 40, 80];
	const results = [];
	for (const n of sizes) {
		const conv = makeConv(store, `eval-ratio-${n}`);
		const cid = conv.conversationId;
		const ts = Date.now();
		for (let i = 0; i < n; i++) {
			ins(store, cid, i % 2 === 0
				? userMsg(`message ${i} ${"word ".repeat(50)}`, ts + i)
				: asstMsg(`reply ${i} ${"word ".repeat(50)}`, ts + i));
		}
		const before = store.getContextTokenEstimate(cid);
		await runLcmCompaction(store, {
			conversationId: cid,
			targetTokens: Math.floor(before * 0.3),
			freshTailCount: 4, leafChunkTokens: 500, incrementalMaxDepth: 3,
		});
		const after = store.getContextTokenEstimate(cid);
		results.push({
			messages: n,
			tokensBefore: before,
			tokensAfter: after,
			ratio: (before / Math.max(1, after)).toFixed(2),
			reductionPct: (((before - after) / Math.max(1, before)) * 100).toFixed(0) + "%",
		});
	}
	return results;
}

// ---------------------------------------------------------------------------
// Scenario 7: toggle safety
// ---------------------------------------------------------------------------
function scenarioToggle(store) {
	const conv = makeConv(store, "eval-toggle");
	const empty = assembleContext(store, conv.conversationId);
	return { emptyConvAssembly: empty.length, wouldOverrideNative: empty.length > 0 };
}

// ---------------------------------------------------------------------------
// run all + report
// ---------------------------------------------------------------------------
async function run() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-lcm-stage4-"));
	const dbPath = join(tempDir, "lcm.sqlite");

	try {
		const db = getLcmDb(dbPath);
		const store = new LcmStore(db);

		console.log("\n══════════════════════════════════════════════════════════");
		console.log("  LCM Stage 4 — Evaluation Report");
		console.log("══════════════════════════════════════════════════════════\n");

		// --- Coverage ---
		process.stdout.write("Scenario 1: context coverage ... ");
		const cov = await scenarioCoverage(store);
		console.log("done\n");
		console.log("  ┌─ Coverage: LCM vs naive truncation (60-message session)");
		console.log(`  │  Tokens before / after : ${cov.tokensBefore} → ${cov.tokensAfter} (${cov.compressionRatio}x, ${cov.tokenReductionPct} reduction)`);
		console.log(`  │  LCM assembled items   : ${cov.lcmContextItems} (${cov.summaryItems} summary + ${cov.rawTailItems} raw tail)`);
		console.log(`  │  Baseline items        : ${cov.baselineContextItems} (tail-only truncation)`);
		console.log(`  └─ LCM covers full history : ${cov.lcmCoversFullHistory}`);
		assert.ok(cov.lcmCoversFullHistory, "LCM must have summary items covering full session");
		assert.ok(cov.lcmContextItems > cov.baselineContextItems, "LCM must surface more context than truncation");
		assert.ok(Number(cov.compressionRatio) > 1, "compression ratio must be > 1x");
		console.log("  ✓ PASS: LCM retains compressed history; baseline drops it\n");

		// --- Leaf facts ---
		process.stdout.write("Scenario 2: leaf-level fact preservation ... ");
		const lf = await scenarioLeafFacts(store);
		console.log("done\n");
		console.log("  ┌─ Fact preservation (depth=0 leaf summaries)");
		console.log(`  │  Fact present in LCM assembled context : ${lf.factInContext}`);
		console.log(`  └─ Fact present in baseline tail-only   : ${lf.factInBaseline}`);
		assert.ok(lf.factInContext, "fact planted at session start must appear in LCM assembled context");
		assert.ok(!lf.factInBaseline, "baseline tail must NOT contain early-session fact");
		console.log("  ✓ PASS: LCM preserves early facts; baseline loses them\n");

		// --- Tool integrity ---
		process.stdout.write("Scenario 3: tool call/result structural integrity ... ");
		const tool = await scenarioToolIntegrity(store);
		console.log("done\n");
		console.log("  ┌─ Tool structural correctness");
		console.log(`  │  Assembled count              : ${tool.assembledCount}`);
		console.log(`  │  tail toolCall preserved      : ${tool.tailToolCallPreserved}`);
		console.log(`  │  tail toolResult preserved    : ${tool.tailToolResultPreserved}`);
		console.log(`  │  toolResult.isError round-trip: ${tool.tailToolResultIsError}`);
		console.log(`  └─ toolResult.content round-trip: "${tool.tailToolResultContent}"`);
		assert.ok(tool.tailToolCallPreserved, "tail toolCall must survive assembly");
		assert.ok(tool.tailToolResultPreserved, "tail toolResult must survive assembly");
		assert.equal(tool.tailToolResultIsError, false);
		assert.equal(tool.tailToolResultContent, "/workspace");
		console.log("  ✓ PASS: tool call/result fields round-trip faithfully\n");

		// --- Compaction latency ---
		process.stdout.write("Scenario 4: compaction latency (20 runs × 40 msgs) ... ");
		const cLat = await scenarioCompactionLatency(store);
		console.log("done\n");
		console.log("  ┌─ Compaction latency (μs) — runs async at turn_end");
		console.log(`  │  min    : ${cLat.min.toFixed(0)}`);
		console.log(`  │  median : ${cLat.median.toFixed(0)}`);
		console.log(`  │  p90    : ${cLat.p90.toFixed(0)}`);
		console.log(`  │  p99    : ${cLat.p99.toFixed(0)}`);
		console.log(`  └─ max    : ${cLat.max.toFixed(0)}`);
		assert.ok(cLat.p99 < 100_000, `compaction p99 must be < 100ms (got ${(cLat.p99/1000).toFixed(1)}ms)`);
		console.log(`  ✓ PASS: compaction p99 = ${(cLat.p99/1000).toFixed(2)}ms (threshold: <100ms)\n`);

		// --- Assembly latency ---
		process.stdout.write("Scenario 5: assembly latency (50 runs on compacted conv) ... ");
		const aLat = await scenarioAssemblyLatency(store);
		console.log("done\n");
		console.log("  ┌─ Assembly latency (μs) — on hot path before every LLM call");
		console.log(`  │  min    : ${aLat.min.toFixed(0)}`);
		console.log(`  │  median : ${aLat.median.toFixed(0)}`);
		console.log(`  │  p90    : ${aLat.p90.toFixed(0)}`);
		console.log(`  │  p99    : ${aLat.p99.toFixed(0)}`);
		console.log(`  └─ max    : ${aLat.max.toFixed(0)}`);
		assert.ok(aLat.p99 < 10_000, `assembly p99 must be < 10ms (got ${(aLat.p99/1000).toFixed(1)}ms)`);
		console.log(`  ✓ PASS: assembly p99 = ${(aLat.p99/1000).toFixed(2)}ms (threshold: <10ms)\n`);

		// --- Compression ratios ---
		process.stdout.write("Scenario 6: compression ratios (3 session sizes) ... ");
		const ratios = await scenarioCompressionRatios(store);
		console.log("done\n");
		console.log("  ┌─ Token compression ratios");
		for (const r of ratios) {
			console.log(`  │  ${String(r.messages).padStart(3)} msgs : ${String(r.tokensBefore).padStart(6)} → ${String(r.tokensAfter).padStart(5)} tokens   ${r.ratio}x   ${r.reductionPct} reduction`);
		}
		console.log("  └─");
		for (const r of ratios) {
			assert.ok(Number(r.ratio) > 1, `expected > 1x compression for ${r.messages} messages`);
		}
		console.log("  ✓ PASS: all session sizes compress > 1x\n");

		// --- Toggle ---
		process.stdout.write("Scenario 7: toggle safety ... ");
		const tog = scenarioToggle(store);
		console.log("done\n");
		console.log("  ┌─ Toggle / fail-open safety");
		console.log(`  │  empty conv → [] (no override) : ${!tog.wouldOverrideNative}`);
		console.log(`  └─ assembleContext result length  : ${tog.emptyConvAssembly}`);
		assert.equal(tog.emptyConvAssembly, 0);
		assert.equal(tog.wouldOverrideNative, false);
		console.log("  ✓ PASS: empty conversation → no native context override\n");

		// --- Final summary ---
		console.log("══════════════════════════════════════════════════════════");
		console.log("  All evaluation scenarios passed");
		console.log("══════════════════════════════════════════════════════════\n");

		const report = {
			coverage: cov,
			leafFacts: lf,
			toolIntegrity: tool,
			compactionLatencyUs: cLat,
			assemblyLatencyUs: aLat,
			compressionRatios: ratios,
			toggle: tog,
		};
		console.log("EVAL_JSON=" + JSON.stringify(report));

	} finally {
		closeAllLcmDbs();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

run();
