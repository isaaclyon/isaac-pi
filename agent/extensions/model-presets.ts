/**
 * Model presets
 *
 * Ctrl+P opens a picker for the four intentionally opinionated model/thinking
 * combinations below. The /preset command provides the same picker and also
 * accepts a preset name directly.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

const STATUS_KEY = "model-preset";
const PROVIDER = "openai-codex";

const PRESETS = [
	{
		name: "Maintainer",
		model: "gpt-5.6-luna",
		thinkingLevel: "medium" as ThinkingLevel,
		description: "Git, commits, exploration, and routine repo work",
	},
	{
		name: "Implementer",
		model: "gpt-5.6-luna",
		thinkingLevel: "xhigh" as ThinkingLevel,
		description: "Main workhorse for building and feature work",
	},
	{
		name: "Expert",
		model: "gpt-5.6-sol",
		thinkingLevel: "low" as ThinkingLevel,
		description: "Tasks beyond routine implementation",
	},
	{
		name: "Architect",
		model: "gpt-5.6-sol",
		thinkingLevel: "xhigh" as ThinkingLevel,
		description: "Complex design and high-stakes changes",
	},
] as const;

type Preset = (typeof PRESETS)[number];

function matchesPreset(preset: Preset, model: ExtensionContext["model"], thinkingLevel: ThinkingLevel): boolean {
	return (
		model?.provider === PROVIDER &&
		model?.id === preset.model &&
		thinkingLevel === preset.thinkingLevel
	);
}

function findMatchingPreset(
	presets: readonly Preset[],
	model: ExtensionContext["model"],
	thinkingLevel: ThinkingLevel,
): Preset | undefined {
	return presets.find((preset) => matchesPreset(preset, model, thinkingLevel));
}

export default function modelPresetsExtension(pi: ExtensionAPI) {
	function updateStatus(ctx: ExtensionContext, model = ctx.model, thinkingLevel = pi.getThinkingLevel()): void {
		if (!ctx.hasUI) return;

		const preset = findMatchingPreset(PRESETS, model, thinkingLevel);
		ctx.ui.setStatus(STATUS_KEY, `preset: ${preset?.name ?? "custom"}`);
	}

	async function applyPreset(preset: Preset, ctx: ExtensionContext): Promise<boolean> {
		const model = ctx.modelRegistry.find(PROVIDER, preset.model);
		if (!model) {
			ctx.ui.notify(`Preset "${preset.name}": model ${PROVIDER}/${preset.model} was not found`, "error");
			return false;
		}

		const modelChanged = await pi.setModel(model);
		if (!modelChanged) {
			ctx.ui.notify(`Preset "${preset.name}": no API key is available for ${PROVIDER}/${preset.model}`, "error");
			return false;
		}

		pi.setThinkingLevel(preset.thinkingLevel);
		updateStatus(ctx, model, pi.getThinkingLevel());
		ctx.ui.notify(`Preset "${preset.name}" activated`, "info");
		return true;
	}

	async function showPicker(ctx: ExtensionContext): Promise<void> {
		const currentPreset = findMatchingPreset(PRESETS, ctx.model, pi.getThinkingLevel());
		const labels = PRESETS.map((preset) => {
			const active = preset === currentPreset ? " (active)" : "";
			return `${preset.name}${active} — ${preset.model} · ${preset.thinkingLevel} — ${preset.description}`;
		});
		const byLabel = new Map(labels.map((label, index) => [label, PRESETS[index]]));
		const selected = await ctx.ui.select("Select model preset", labels);
		const preset = selected ? byLabel.get(selected) : undefined;
		if (preset) await applyPreset(preset, ctx);
	}

	pi.registerShortcut("ctrl+p", {
		description: "Open model preset picker",
		handler: async (ctx) => {
			await showPicker(ctx);
		},
	});

	pi.registerCommand("preset", {
		description: "Select a model preset",
		handler: async (args, ctx) => {
			const requested = args.trim().toLowerCase();
			if (!requested) {
				await showPicker(ctx);
				return;
			}

			const preset = PRESETS.find((candidate) => candidate.name.toLowerCase() === requested);
			if (!preset) {
				ctx.ui.notify(`Unknown preset "${args.trim()}". Available: ${PRESETS.map((item) => item.name).join(", ")}`, "error");
				return;
			}

			await applyPreset(preset, ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		updateStatus(ctx);
	});

	pi.on("model_select", async (event, ctx) => {
		updateStatus(ctx, event.model);
	});

	pi.on("thinking_level_select", async (event, ctx) => {
		updateStatus(ctx, ctx.model, event.level);
	});
}
