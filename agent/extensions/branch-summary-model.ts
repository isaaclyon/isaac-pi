import {
	generateBranchSummary,
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { streamSimple, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai/compat";
import { parseBranchSummaryModelSettings, readBranchSummaryModelSettings, type BranchSummaryModelSettings } from "../branch-summary-model-config.ts";

const CONFIG_PATH = `${getAgentDir()}/branch-summary-model.json`;

function notify(ctx: ExtensionContext, message: string): void {
	ctx.ui.notify(`[branch-summary-model] ${message}`, "warning");
}

async function generateSummary(
	entries: Parameters<typeof generateBranchSummary>[0],
	settings: BranchSummaryModelSettings,
	ctx: ExtensionContext,
	model: Model<any>,
	signal: AbortSignal,
): Promise<{ summary: string; details?: unknown } | undefined> {
	const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok || !auth.apiKey) {
		notify(ctx, `No usable authentication for ${settings.provider}/${settings.model}`);
		return undefined;
	}

	const result = await generateBranchSummary(entries, {
		model,
		apiKey: auth.apiKey,
		headers: auth.headers,
		env: auth.env,
		signal,
		streamFn: (summaryModel, context, options?: SimpleStreamOptions) =>
			streamSimple(summaryModel, context, {
				...options,
				reasoning: settings.thinkingLevel,
			}),
	});

	if (result.error) {
		notify(ctx, result.error);
		return undefined;
	}
	if (result.aborted || !result.summary) return undefined;

	return {
		summary: result.summary,
		details: {
			readFiles: result.readFiles ?? [],
			modifiedFiles: result.modifiedFiles ?? [],
		},
	};
}

export default function branchSummaryModel(pi: ExtensionAPI): void {
	pi.on("session_before_tree", async (event, ctx) => {
		if (!event.preparation.userWantsSummary || event.preparation.entriesToSummarize.length === 0) return;

		const settings = readBranchSummaryModelSettings(CONFIG_PATH);
		if (!settings) {
			notify(ctx, `Invalid or unreadable config: ${CONFIG_PATH}`);
			return { cancel: true };
		}

		const model = ctx.modelRegistry.find(settings.provider, settings.model);
		if (!model) {
			notify(ctx, `Configured model is unavailable: ${settings.provider}/${settings.model}`);
			return { cancel: true };
		}

		try {
			const summary = await generateSummary(event.preparation.entriesToSummarize, settings, ctx, model, event.signal);
			if (!summary) return { cancel: true };
			return { summary };
		} catch (error) {
			notify(ctx, error instanceof Error ? error.message : String(error));
			return { cancel: true };
		}
	});
}
