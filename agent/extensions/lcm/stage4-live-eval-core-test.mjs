import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	assertProviderCredentials,
	evaluateLiveGate,
	resolveLiveEvalConfig,
	resolveProviderApiKey,
	scoreRecall,
} from "./stage4-live-eval-core.ts";

function testResolveDefaults() {
	const cfg = resolveLiveEvalConfig({});
	assert.equal(cfg.provider, "openai-codex");
	assert.equal(cfg.modelId, "gpt-5.3-codex");
	assert.equal(cfg.reasoning, "low");
	assert.equal(cfg.minRecall, 0.67);
	assert.equal(cfg.maxModelCalls, 5);
	assert.equal(cfg.freshTailCount, 2);
	assert.equal(cfg.leafChunkTokens, 300);
	assert.equal(cfg.incrementalMaxDepth, 2);
	assert.equal(cfg.targetTokens, 200);
}

function testResolveOverrides() {
	const cfg = resolveLiveEvalConfig({
		PI_LCM_LIVE_EVAL_PROVIDER: "openrouter",
		PI_LCM_LIVE_EVAL_MODEL_ID: "openai/gpt-4o-mini",
		PI_LCM_LIVE_EVAL_REASONING: "high",
		PI_LCM_LIVE_EVAL_MIN_RECALL: "0.75",
		PI_LCM_LIVE_EVAL_MAX_MODEL_CALLS: "4",
		PI_LCM_LIVE_EVAL_FRESH_TAIL_COUNT: "4",
		PI_LCM_LIVE_EVAL_LEAF_CHUNK_TOKENS: "500",
		PI_LCM_LIVE_EVAL_INCREMENTAL_MAX_DEPTH: "3",
		PI_LCM_LIVE_EVAL_TARGET_TOKENS: "350",
	});
	assert.equal(cfg.provider, "openrouter");
	assert.equal(cfg.modelId, "openai/gpt-4o-mini");
	assert.equal(cfg.reasoning, "high");
	assert.equal(cfg.minRecall, 0.75);
	assert.equal(cfg.maxModelCalls, 4);
	assert.equal(cfg.freshTailCount, 4);
	assert.equal(cfg.leafChunkTokens, 500);
	assert.equal(cfg.incrementalMaxDepth, 3);
	assert.equal(cfg.targetTokens, 350);
}

function testInvalidThresholdsThrow() {
	assert.throws(() => resolveLiveEvalConfig({ PI_LCM_LIVE_EVAL_MIN_RECALL: "1.2" }), /PI_LCM_LIVE_EVAL_MIN_RECALL/);
	assert.throws(() => resolveLiveEvalConfig({ PI_LCM_LIVE_EVAL_MAX_MODEL_CALLS: "0" }), /PI_LCM_LIVE_EVAL_MAX_MODEL_CALLS/);
	assert.throws(() => resolveLiveEvalConfig({ PI_LCM_LIVE_EVAL_TARGET_TOKENS: "0" }), /PI_LCM_LIVE_EVAL_TARGET_TOKENS/);
	assert.throws(() => resolveLiveEvalConfig({ PI_LCM_LIVE_EVAL_REASONING: "turbo" }), /PI_LCM_LIVE_EVAL_REASONING/);
}

function testScoreRecallCaseInsensitive() {
	const expected = ["FACT_ALPHA_19", "FACT_BRAVO_42", "FACT_CHARLIE_77"];
	const answer = "I found fact_alpha_19 and fact_charlie_77, but not the second one.";
	const score = scoreRecall(expected, answer);
	assert.deepEqual(score.found.sort(), ["FACT_ALPHA_19", "FACT_CHARLIE_77"].sort());
	assert.deepEqual(score.missing, ["FACT_BRAVO_42"]);
	assert.equal(score.recall, 2 / 3);
}

function testEvaluateGate() {
	const pass = evaluateLiveGate({ recall: 0.8, modelCalls: 4 }, { minRecall: 0.67, maxModelCalls: 5 });
	assert.equal(pass.ok, true);
	assert.equal(pass.reasons.length, 0);

	const failRecall = evaluateLiveGate({ recall: 0.33, modelCalls: 4 }, { minRecall: 0.67, maxModelCalls: 5 });
	assert.equal(failRecall.ok, false);
	assert.ok(failRecall.reasons.some((r) => r.includes("recall")));

	const failCalls = evaluateLiveGate({ recall: 0.9, modelCalls: 8 }, { minRecall: 0.67, maxModelCalls: 5 });
	assert.equal(failCalls.ok, false);
	assert.ok(failCalls.reasons.some((r) => r.includes("model calls")));
}

function testProviderCredentialChecks() {
	assert.doesNotThrow(() => assertProviderCredentials("anthropic", { ANTHROPIC_API_KEY: "x" }));
	assert.throws(
		() => assertProviderCredentials("anthropic", {}),
		/ANTHROPIC_API_KEY/,
		"anthropic should require ANTHROPIC_API_KEY",
	);
	assert.doesNotThrow(() => assertProviderCredentials("openrouter", { OPENROUTER_API_KEY: "x" }));
	assert.throws(() => assertProviderCredentials("openrouter", {}), /OPENROUTER_API_KEY/);
	assert.throws(() => assertProviderCredentials("openai-codex", {}), /OpenAI Codex OAuth token/);
	assert.doesNotThrow(() => assertProviderCredentials("openai-codex", { PI_LCM_LIVE_EVAL_API_KEY: "x" }));

	const dir = mkdtempSync(join(tmpdir(), "lcm-live-cred-"));
	try {
		const authPath = join(dir, "auth.json");
		writeFileSync(authPath, JSON.stringify({ tokens: { access_token: "token-from-auth-file" } }), "utf-8");
		assert.doesNotThrow(() =>
			assertProviderCredentials("openai-codex", { PI_LCM_LIVE_EVAL_CODEX_AUTH_PATH: authPath }),
		);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	assert.doesNotThrow(() => assertProviderCredentials("unknown-provider", {}), "unknown providers should not be hard-blocked");
}

function testResolveProviderApiKey() {
	const explicit = resolveProviderApiKey("openai-codex", { PI_LCM_LIVE_EVAL_API_KEY: "token-explicit" });
	assert.equal(explicit, "token-explicit");

	const dir = mkdtempSync(join(tmpdir(), "lcm-live-key-"));
	try {
		const authPath = join(dir, "auth.json");
		writeFileSync(
			authPath,
			JSON.stringify({ tokens: { access_token: "token-from-codex-auth" } }),
			"utf-8",
		);
		const fromCodex = resolveProviderApiKey("openai-codex", {
			PI_LCM_LIVE_EVAL_CODEX_AUTH_PATH: authPath,
		});
		assert.equal(fromCodex, "token-from-codex-auth");

		const missing = resolveProviderApiKey("openai-codex", {
			PI_LCM_LIVE_EVAL_CODEX_AUTH_PATH: join(dir, "missing.json"),
		});
		assert.equal(missing, undefined);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

function run() {
	testResolveDefaults();
	testResolveOverrides();
	testInvalidThresholdsThrow();
	testScoreRecallCaseInsensitive();
	testEvaluateGate();
	testProviderCredentialChecks();
	testResolveProviderApiKey();
	console.log("stage4-live-eval-core tests passed");
}

run();
