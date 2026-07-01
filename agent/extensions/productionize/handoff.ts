import type { CommandFailure } from "./core.ts";
import type { ProductionizeState } from "./types.ts";

const OUTPUT_LIMIT = 1200;

export function buildProductionizeFailurePrompt(state: Pick<ProductionizeState, "failure" | "status">): string {
	const failure = state.failure;
	if (!failure) {
		return [
			"Productionize failed.",
			state.status,
			"Fix the issue in this same session, then call `productionize_run` once after the fix is in place.",
			"Do not use side agents, patch import/export, hidden autofix, or autonomous retry loops.",
		]
			.filter(Boolean)
			.join("\n\n");
	}

	return [
		"Productionize failed. Fix the issue in this same session, then call `productionize_run` once after the fix is in place.",
		"Do not use side agents, patch import/export, hidden autofix, or autonomous retry loops.",
		state.status ? `Run status: ${state.status}` : undefined,
		formatFailureDetails(failure),
	]
		.filter(Boolean)
		.join("\n\n");
}

export function buildProductionizeCompletionMessage(state: Pick<ProductionizeState, "outcome" | "status" | "failure">): string {
	if (state.outcome === "succeeded" || state.outcome === "cancelled") return state.status;
	if (state.outcome !== "failed") return `Productionize run status: ${state.status}`;
	return buildProductionizeFailurePrompt(state);
}

function formatFailureDetails(failure: CommandFailure): string {
	const lines = [
		`Failed step: ${failure.step}`,
		failure.command ? `Command: ${formatCommand(failure)}` : undefined,
		failure.cwd ? `Working directory: ${failure.cwd}` : undefined,
		failure.code !== undefined ? `Exit code: ${failure.code}` : undefined,
		failure.message ? `Message: ${failure.message}` : undefined,
		formatOutputBlock("stdout", failure.stdout),
		formatOutputBlock("stderr", failure.stderr),
	].filter((line): line is string => Boolean(line));
	return lines.join("\n");
}

function formatCommand(failure: CommandFailure): string {
	return [failure.command, ...(failure.args ?? [])].filter(Boolean).join(" ");
}

function formatOutputBlock(label: "stdout" | "stderr", value?: string): string | undefined {
	const text = truncateOutput(value);
	if (!text) return undefined;
	return `${label}:\n\n\`\`\`\n${text}\n\`\`\``;
}

function truncateOutput(value?: string): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (trimmed.length <= OUTPUT_LIMIT) return trimmed;
	return `${trimmed.slice(0, OUTPUT_LIMIT)}\n… [truncated ${trimmed.length - OUTPUT_LIMIT} chars]`;
}
