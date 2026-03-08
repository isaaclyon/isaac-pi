import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { resolveLiveEvalConfig } from "./stage4-live-eval-core.ts";
import {
	buildSweepSummary,
	computeEffortStats,
	evaluateSweepMeanGate,
	groupRunsByEffort,
} from "./stage4-live-eval-sweep-core.ts";

const ALLOWED_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"];

function parseRunsPerEffort(env) {
	const raw = env.PI_LCM_LIVE_EVAL_SWEEP_RUNS;
	if (!raw || raw.trim() === "") {
		return 5;
	}
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`PI_LCM_LIVE_EVAL_SWEEP_RUNS invalid: ${raw}. Expected an integer >= 1.`);
	}
	return parsed;
}

function parseEfforts(env) {
	const raw = env.PI_LCM_LIVE_EVAL_SWEEP_EFFORTS?.trim() || "low,medium";
	const efforts = raw
		.split(",")
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value.length > 0);
	if (efforts.length === 0) {
		throw new Error("PI_LCM_LIVE_EVAL_SWEEP_EFFORTS produced no efforts. Example: low,medium");
	}
	for (const effort of efforts) {
		if (!ALLOWED_EFFORTS.includes(effort)) {
			throw new Error(
				`PI_LCM_LIVE_EVAL_SWEEP_EFFORTS invalid effort '${effort}'. ` +
				`Allowed: ${ALLOWED_EFFORTS.join(", ")}`,
			);
		}
	}
	return [...new Set(efforts)];
}

function resolveOutputPath(env, scriptDir) {
	const explicit = env.PI_LCM_LIVE_EVAL_SWEEP_OUTPUT_PATH?.trim();
	if (explicit) {
		return explicit;
	}
	return join(scriptDir, "stage4-live-eval-sweep-summary.json");
}

function extractLiveEvalReport(stdout, stderr) {
	const combined = `${stdout || ""}\n${stderr || ""}`;
	const lines = combined.split(/\r?\n/);
	for (const line of lines) {
		if (!line.startsWith("LIVE_EVAL_JSON=")) {
			continue;
		}
		const raw = line.slice("LIVE_EVAL_JSON=".length).trim();
		if (!raw) {
			continue;
		}
		try {
			return JSON.parse(raw);
		} catch {
			return null;
		}
	}
	return null;
}

function pct(value) {
	return `${(value * 100).toFixed(1)}%`;
}

function printSummaryTable(summary) {
	console.log("\n══════════════════════════════════════════════════════════");
	console.log("  LCM Stage 4 Live Eval Sweep");
	console.log("══════════════════════════════════════════════════════════");
	console.log(`Model                : ${summary.provider}/${summary.modelId}`);
	console.log(`Threshold (mean)     : ${pct(summary.config.minRecall)}`);
	console.log(`Runs per effort      : ${summary.config.runsPerEffort}`);
	console.log(`Efforts              : ${summary.config.efforts.join(", ")}`);
	console.log(`Retrieval mode       : ${summary.config.retrievalMode}`);
	console.log("");
	console.log("Effort   Runs  Mean     Min      Max      Pass  Fail  Errors");
	for (const row of summary.byEffort) {
		console.log(
			`${row.effort.padEnd(7)}  ${String(row.runCount).padStart(4)}  ${pct(row.meanRecall).padStart(7)}  ${pct(row.minRecall).padStart(7)}  ${pct(row.maxRecall).padStart(7)}  ${String(row.passCount).padStart(4)}  ${String(row.failCount).padStart(4)}  ${String(row.errorCount).padStart(6)}`,
		);
	}
	console.log("");
	console.log("Effort   Retrieval used  Tool calls  Tool errors  Tool names");
	for (const row of summary.byEffort) {
		const toolNames = row.retrievalToolNames.length > 0 ? row.retrievalToolNames.join(",") : "-";
		console.log(
			`${row.effort.padEnd(7)}  ${pct(row.retrievalUsageRate).padStart(14)}  ${String(row.retrievalToolCallCount).padStart(10)}  ${String(row.retrievalToolErrorCount).padStart(11)}  ${toolNames}`,
		);
	}
	console.log("");
	console.log(`Gate                 : ${summary.gate.ok ? "PASS" : "FAIL"}`);
	if (!summary.gate.ok) {
		for (const reason of summary.gate.reasons) {
			console.log(`  - ${reason}`);
		}
	}
	console.log(`Duration             : ${(summary.timing.durationMs / 1000).toFixed(1)}s`);
	console.log("══════════════════════════════════════════════════════════\n");
}

async function run() {
	const scriptDir = dirname(fileURLToPath(import.meta.url));
	const singleEvalScript = join(scriptDir, "stage4-live-eval.mjs");
	const baseCfg = resolveLiveEvalConfig(process.env);
	const runsPerEffort = parseRunsPerEffort(process.env);
	const efforts = parseEfforts(process.env);
	const outputPath = resolveOutputPath(process.env, scriptDir);

	const startedAt = new Date().toISOString();
	const runResults = [];

	for (const effort of efforts) {
		for (let runNumber = 1; runNumber <= runsPerEffort; runNumber += 1) {
			console.log(`[sweep] ${effort} run ${runNumber}/${runsPerEffort} ...`);
			const child = spawnSync(process.execPath, [singleEvalScript], {
				env: {
					...process.env,
					PI_LCM_LIVE_EVAL_REASONING: effort,
				},
				encoding: "utf8",
				maxBuffer: 1024 * 1024 * 10,
			});

			const report = extractLiveEvalReport(child.stdout, child.stderr);
			if (report && typeof report === "object") {
				const retrieval = report?.retrieval && typeof report.retrieval === "object"
					? {
						mode: report.retrieval.mode === "retrieval-aware" ? "retrieval-aware" : "summary-only",
						used: Boolean(report.retrieval.used),
						toolCallCount: typeof report.retrieval.toolCallCount === "number" ? report.retrieval.toolCallCount : 0,
						toolNames: Array.isArray(report.retrieval.toolNames)
							? report.retrieval.toolNames.filter((name) => typeof name === "string")
							: [],
						steps: typeof report.retrieval.steps === "number" ? report.retrieval.steps : 0,
						toolErrorCount: typeof report.retrieval.toolErrorCount === "number" ? report.retrieval.toolErrorCount : 0,
					}
					: undefined;
				runResults.push({
					effort,
					runNumber,
					recall: typeof report?.recall?.recall === "number" ? report.recall.recall : 0,
					gateOk: Boolean(report?.gate?.ok),
					report,
					retrieval,
				});
				continue;
			}

			const error =
				(child.stderr || child.stdout || "unknown error")
					.toString()
					.trim()
					.split(/\r?\n/)
					.slice(-3)
					.join(" | ") ||
				`stage4-live-eval exited with code ${child.status ?? "unknown"}`;
			runResults.push({
				effort,
				runNumber,
				recall: 0,
				gateOk: false,
				executionError: error,
			});
		}
	}

	const grouped = groupRunsByEffort(runResults, efforts);
	const effortStats = computeEffortStats(grouped, baseCfg.minRecall);
	const gate = evaluateSweepMeanGate(effortStats, baseCfg.minRecall);
	const finishedAt = new Date().toISOString();
	const summary = buildSweepSummary({
		provider: baseCfg.provider,
		modelId: baseCfg.modelId,
		minRecall: baseCfg.minRecall,
		retrievalMode: baseCfg.retrievalMode,
		runsPerEffort,
		efforts,
		startedAt,
		finishedAt,
		runResults,
		effortStats,
		gate,
	});

	mkdirSync(dirname(outputPath), { recursive: true });
	writeFileSync(outputPath, JSON.stringify(summary, null, 2), "utf8");

	printSummaryTable(summary);
	console.log(`Summary JSON written : ${outputPath}`);
	console.log("LIVE_EVAL_SWEEP_JSON=" + JSON.stringify(summary));

	if (!summary.gate.ok) {
		throw new Error(`Live eval sweep gate failed: ${summary.gate.reasons.join("; ")}`);
	}
}

run().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`\n[lcm-live-eval-sweep] ${message}`);
	process.exit(1);
});
