import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { assembleContext } from "./assembly.ts";
import { runLcmCompaction } from "./compaction.ts";
import { closeAllLcmDbs, getLcmDb } from "./db.ts";
import { createLlmSummarizer } from "./summarizer.ts";
import {
	assertProviderCredentials,
	evaluateLiveGate,
	resolveLiveEvalConfig,
	resolveProviderApiKey,
	scoreRecall,
} from "./stage4-live-eval-core.ts";
import { LcmStore } from "./store.ts";
import { toStoredMessage } from "./types.ts";

/**
 * Live LCM recall quality smoke test (real model calls).
 *
 * Usage:
 *   node --experimental-strip-types agent/extensions/lcm/stage4-live-eval.mjs
 *
 * Optional env vars:
 *   PI_LCM_LIVE_EVAL_PROVIDER=openai-codex
 *   PI_LCM_LIVE_EVAL_MODEL_ID=gpt-5.3-codex
 *   PI_LCM_LIVE_EVAL_REASONING=low
 *   PI_LCM_LIVE_EVAL_MIN_RECALL=0.67
 *   PI_LCM_LIVE_EVAL_MAX_MODEL_CALLS=5
 *   PI_LCM_LIVE_EVAL_TARGET_TOKENS=200
 *   PI_LCM_LIVE_EVAL_FRESH_TAIL_COUNT=2
 *   PI_LCM_LIVE_EVAL_LEAF_CHUNK_TOKENS=300
 *   PI_LCM_LIVE_EVAL_INCREMENTAL_MAX_DEPTH=2
 */

function userMsg(text, timestamp) {
	return {
		role: "user",
		content: [{ type: "text", text }],
		timestamp,
	};
}

function assistantMsg(text, timestamp) {
	return {
		role: "assistant",
		content: [{ type: "text", text }],
		timestamp,
		api: "anthropic",
		provider: "anthropic",
		model: "claude-3-5-haiku-latest",
		usage: {
			input: 10,
			output: 5,
			cacheRead: 0,
			cacheWrite: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "end_turn",
	};
}

function toPlainText(content) {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const lines = [];
	for (const block of content) {
		if (!block || typeof block !== "object") {
			continue;
		}
		if (block.type === "text" && typeof block.text === "string") {
			lines.push(block.text);
			continue;
		}
		if (block.type === "thinking" && typeof block.thinking === "string") {
			lines.push(block.thinking);
			continue;
		}
		if (block.type === "toolCall") {
			lines.push(`[toolCall] ${block.name ?? "unknown"}`);
		}
	}
	return lines.join("\n");
}

function extractAssistantText(message) {
	if (!message || !Array.isArray(message.content)) {
		return "";
	}
	return message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n")
		.trim();
}

async function loadPiAiModule() {
	const explicitPath = process.env.PI_LCM_LIVE_EVAL_PI_AI_PATH?.trim();
	const nodeInstallRoot = dirname(dirname(process.execPath));
	const inferredGlobalPath = join(
		nodeInstallRoot,
		"lib/node_modules/@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/index.js",
	);

	const candidates = [
		explicitPath || null,
		"@mariozechner/pi-ai",
		"@mariozechner/pi-coding-agent/node_modules/@mariozechner/pi-ai/dist/index.js",
		inferredGlobalPath,
	].filter((value) => typeof value === "string" && value.length > 0);

	for (const candidate of candidates) {
		try {
			if (candidate.startsWith("/") && existsSync(candidate)) {
				return await import(pathToFileURL(candidate).href);
			}
			return await import(candidate);
		} catch {
			// Try next candidate
		}
	}

	throw new Error(
		"Unable to load @mariozechner/pi-ai. " +
			"Set PI_LCM_LIVE_EVAL_PI_AI_PATH to a valid dist/index.js path if auto-discovery fails.",
	);
}

function resolveModelOrThrow(provider, modelId, piAi) {
	const providerList = piAi.getProviders().join(", ");
	let hint = `Known providers: ${providerList}`;
	if (piAi.getProviders().includes(provider)) {
		const ids = piAi.getModels(provider).slice(0, 25).map((m) => m.id);
		hint = `Known model IDs for '${provider}' (first 25): ${ids.join(", ")}`;
	}
	try {
		const model = piAi.getModel(provider, modelId);
		if (!model || typeof model !== "object" || typeof model.api !== "string") {
			throw new Error("Model not found");
		}
		return model;
	} catch (error) {
		const msg = error instanceof Error ? error.message : String(error);
		throw new Error(`Unable to resolve model '${provider}/${modelId}': ${msg}. ${hint}`);
	}
}

function seedConversation(store, conversationId, facts) {
	const ts = Date.now();
	const lines = [
		`Kickoff notes. Fact marker: ${facts[0]}. ${"context ".repeat(28)}`,
		`Working through setup details. ${"detail ".repeat(28)}`,
		`Checkpoint notes include marker ${facts[1]} and implementation detail. ${"context ".repeat(26)}`,
		`Discussed options and narrowed the approach. ${"detail ".repeat(28)}`,
		`Decision captured with marker ${facts[2]} plus rationale. ${"context ".repeat(26)}`,
		`Implementation progress update. ${"detail ".repeat(28)}`,
		`Validation prep and follow-up actions. ${"context ".repeat(28)}`,
		`Regression check notes. ${"detail ".repeat(28)}`,
		`Recent turn near tail (non-fact). ${"context ".repeat(22)}`,
		`Latest turn near tail (non-fact). ${"detail ".repeat(22)}`,
	];

	for (let i = 0; i < lines.length; i += 1) {
		const msg = i % 2 === 0 ? userMsg(lines[i], ts + i * 1000) : assistantMsg(lines[i], ts + i * 1000);
		store.insertMessage(conversationId, toStoredMessage(msg, `live-${i}`));
	}
}

function assembleTranscript(messages) {
	return messages
		.map((msg, idx) => {
			const text = toPlainText(msg.content).replace(/\s+/g, " ").trim();
			return `${idx + 1}. ${msg.role}: ${text}`;
		})
		.join("\n");
}

async function run() {
	const cfg = resolveLiveEvalConfig(process.env);
	assertProviderCredentials(cfg.provider, process.env);
	const providerApiKey = resolveProviderApiKey(cfg.provider, process.env);

	if (cfg.maxModelCalls < 2) {
		throw new Error("PI_LCM_LIVE_EVAL_MAX_MODEL_CALLS must be >= 2 (one recall query + at least one summary call)");
	}

	const piAi = await loadPiAiModule();
	const model = resolveModelOrThrow(cfg.provider, cfg.modelId, piAi);
	const facts = ["FACT_ALPHA_19", "FACT_BRAVO_42", "FACT_CHARLIE_77"];

	const tempDir = mkdtempSync(join(tmpdir(), "pi-lcm-stage4-live-"));
	const dbPath = join(tempDir, "lcm-live.sqlite");

	let summaryModelCalls = 0;
	let recallModelCalls = 0;

	try {
		const db = getLcmDb(dbPath);
		const store = new LcmStore(db);
		const conv = store.getOrCreateConversation({
			conversationKey: "live-eval-recall",
			sessionFile: null,
			cwd: "/tmp",
		});

		seedConversation(store, conv.conversationId, facts);

		const compactionBudget = cfg.maxModelCalls - 1;
		const streamSimpleWithAuth = (targetModel, context) =>
			piAi.streamSimple(
				targetModel,
				context,
				providerApiKey ? { apiKey: providerApiKey, reasoning: cfg.reasoning } : { reasoning: cfg.reasoning },
			);
		const baseSummarizer = createLlmSummarizer(streamSimpleWithAuth, model);
		const summarizer = async (input) => {
			summaryModelCalls += 1;
			if (summaryModelCalls > compactionBudget) {
				throw new Error(
					`Compaction exceeded model-call budget (${summaryModelCalls} > ${compactionBudget}). ` +
					`Raise PI_LCM_LIVE_EVAL_MAX_MODEL_CALLS or reduce compaction workload.`,
				);
			}
			return baseSummarizer(input);
		};

		const compaction = await runLcmCompaction(store, {
			conversationId: conv.conversationId,
			targetTokens: cfg.targetTokens,
			freshTailCount: cfg.freshTailCount,
			leafChunkTokens: cfg.leafChunkTokens,
			incrementalMaxDepth: cfg.incrementalMaxDepth,
			summarizer,
		});

		const assembled = assembleContext(store, conv.conversationId);
		const transcript = assembleTranscript(assembled);

		recallModelCalls += 1;
		const recallOptions =
			cfg.provider === "openai-codex"
				? (providerApiKey ? { apiKey: providerApiKey, reasoning: cfg.reasoning } : { reasoning: cfg.reasoning })
				: (providerApiKey
					? { temperature: 0, apiKey: providerApiKey, reasoning: cfg.reasoning }
					: { temperature: 0, reasoning: cfg.reasoning });
		const recallReply = await piAi.completeSimple(
			model,
			{
				systemPrompt:
					"You are a strict evaluator. Identify which fact IDs are explicitly present in the transcript. " +
					"Return only a comma-separated list of IDs found, or NONE.",
				messages: [
					{
						role: "user",
						content:
							`Candidate IDs: ${facts.join(", ")}\n\n` +
							"Transcript:\n" +
							transcript,
						timestamp: Date.now(),
					},
				],
			},
			recallOptions,
		);
		const recallAnswer = extractAssistantText(recallReply);
		const recall = scoreRecall(facts, recallAnswer);

		const totalModelCalls = summaryModelCalls + recallModelCalls;
		const gate = evaluateLiveGate(
			{ recall: recall.recall, modelCalls: totalModelCalls },
			{ minRecall: cfg.minRecall, maxModelCalls: cfg.maxModelCalls },
		);

		const report = {
			provider: cfg.provider,
			modelId: cfg.modelId,
			config: {
				reasoning: cfg.reasoning,
				minRecall: cfg.minRecall,
				maxModelCalls: cfg.maxModelCalls,
				targetTokens: cfg.targetTokens,
				freshTailCount: cfg.freshTailCount,
				leafChunkTokens: cfg.leafChunkTokens,
				incrementalMaxDepth: cfg.incrementalMaxDepth,
			},
			expectedFacts: facts,
			modelAnswer: recallAnswer,
			recallReply: {
				stopReason: recallReply.stopReason,
				errorMessage: recallReply.errorMessage,
			},
			recall,
			modelCalls: {
				summary: summaryModelCalls,
				recall: recallModelCalls,
				total: totalModelCalls,
			},
			compaction: {
				initialTokens: compaction.initialTokens,
				finalTokens: compaction.finalTokens,
				createdLeafCount: compaction.createdLeafCount,
				createdCondensedCount: compaction.createdCondensedCount,
				strategyUsed: compaction.strategyUsed,
			},
			assembledMessageCount: assembled.length,
			gate,
		};

		console.log("\n══════════════════════════════════════════════════════════");
		console.log("  LCM Stage 4 Live Eval — Recall Quality (Quick Smoke)");
		console.log("══════════════════════════════════════════════════════════");
		console.log(`Model                : ${cfg.provider}/${cfg.modelId}`);
		console.log(`Reasoning effort     : ${cfg.reasoning}`);
		console.log(`Recall               : ${(recall.recall * 100).toFixed(1)}% (${recall.found.length}/${facts.length})`);
		console.log(`Found                : ${recall.found.join(", ") || "(none)"}`);
		console.log(`Missing              : ${recall.missing.join(", ") || "(none)"}`);
		console.log(`Model calls          : ${totalModelCalls} (summary=${summaryModelCalls}, recall=${recallModelCalls})`);
		console.log(`Compaction           : ${compaction.initialTokens} -> ${compaction.finalTokens} (leaf=${compaction.createdLeafCount}, condensed=${compaction.createdCondensedCount}, strategy=${compaction.strategyUsed ?? "n/a"})`);
		console.log(`Gate                 : ${gate.ok ? "PASS" : "FAIL"}`);
		if (!gate.ok) {
			for (const reason of gate.reasons) {
				console.log(`  - ${reason}`);
			}
		}
		console.log("══════════════════════════════════════════════════════════\n");
		console.log("LIVE_EVAL_JSON=" + JSON.stringify(report));

		if (!gate.ok) {
			throw new Error(`Live eval gate failed: ${gate.reasons.join("; ")}`);
		}
	} finally {
		closeAllLcmDbs();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

run().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`\n[lcm-live-eval] ${message}`);
	process.exit(1);
});
