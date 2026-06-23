import { execFileSync } from "node:child_process";
import type { QuestionParams } from "./tool/types.js";

const STATUS_KEY = "ask-user-question";
const CMUX_STATUS_VALUE = "needs input";
const CMUX_STATUS_COLOR = "#f59e0b";

export interface AttentionUi {
	notify(message: string, level?: "info" | "warning" | "error"): void;
	setStatus(key: string, value?: string): void;
}

export interface AttentionContext {
	hasUI: boolean;
	ui?: AttentionUi;
}

type CommandRunner = (command: string, args: string[]) => void;

interface AttentionCopy {
	cmuxTitle: string;
	cmuxSubtitle?: string;
	cmuxBody: string;
	uiStatus: string;
}

function normalizeSingleLine(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxLength: number): string {
	return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trimEnd()}…`;
}

export function buildAttentionCopy(params: QuestionParams): AttentionCopy {
	const count = params.questions.length;
	const first = params.questions[0];
	const firstLabel = normalizeSingleLine(first?.header || first?.question || "question");
	const compactLabel = truncate(firstLabel, 72);

	if (count === 1) {
		return {
			cmuxTitle: "Pi needs input",
			cmuxSubtitle: compactLabel,
			cmuxBody: "Answer the question in Pi to continue.",
			uiStatus: `awaiting answer · ${compactLabel}`,
		};
	}

	return {
		cmuxTitle: "Pi needs input",
		cmuxSubtitle: `${count} questions waiting`,
		cmuxBody: `First topic: ${compactLabel}`,
		uiStatus: `awaiting answers · ${count} questions`,
	};
}

function defaultRunner(command: string, args: string[]): void {
	execFileSync(command, args, {
		stdio: "ignore",
		timeout: 1000,
	});
}

function runBestEffort(command: string, args: string[], runner: CommandRunner): void {
	try {
		runner(command, args);
	} catch {
		// Best-effort only. Attention helpers must never break the questionnaire.
	}
}

function cmuxTargetArgs(env: NodeJS.ProcessEnv): string[] {
	const args: string[] = [];
	if (env.CMUX_WORKSPACE_ID) args.push("--workspace", env.CMUX_WORKSPACE_ID);
	if (env.CMUX_SURFACE_ID) args.push("--surface", env.CMUX_SURFACE_ID);
	return args;
}

function hasCmuxTarget(env: NodeJS.ProcessEnv): boolean {
	return Boolean(env.CMUX_WORKSPACE_ID || env.CMUX_SURFACE_ID);
}

export function beginQuestionAttention(
	ctx: AttentionContext,
	params: QuestionParams,
	options?: {
		env?: NodeJS.ProcessEnv;
		runner?: CommandRunner;
	},
): () => void {
	const env = options?.env ?? process.env;
	const runner = options?.runner ?? defaultRunner;
	const copy = buildAttentionCopy(params);

	if (ctx.hasUI && ctx.ui) {
		ctx.ui.setStatus(STATUS_KEY, copy.uiStatus);
	}

	if (hasCmuxTarget(env)) {
		const targetArgs = cmuxTargetArgs(env);
		runBestEffort(
			"cmux",
			[
				"notify",
				"--title",
				copy.cmuxTitle,
				...(copy.cmuxSubtitle ? ["--subtitle", copy.cmuxSubtitle] : []),
				"--body",
				copy.cmuxBody,
				...targetArgs,
			],
			runner,
		);
		runBestEffort("cmux", ["trigger-flash", ...targetArgs], runner);
		if (env.CMUX_WORKSPACE_ID) {
			runBestEffort(
				"cmux",
				[
					"set-status",
					STATUS_KEY,
					CMUX_STATUS_VALUE,
					"--workspace",
					env.CMUX_WORKSPACE_ID,
					"--color",
					CMUX_STATUS_COLOR,
				],
				runner,
			);
		}
	}

	return () => {
		if (ctx.hasUI && ctx.ui) {
			ctx.ui.setStatus(STATUS_KEY, undefined);
		}
		if (env.CMUX_WORKSPACE_ID) {
			runBestEffort(
				"cmux",
				["clear-status", STATUS_KEY, "--workspace", env.CMUX_WORKSPACE_ID],
				runner,
			);
		}
	};
}
