/**
 * Model presets
 *
 * Ctrl+P opens a picker for the four intentionally opinionated model/thinking
 * combinations below. The /preset command provides the same picker and also
 * accepts a preset name directly.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { MODEL_PRESETS, type ThinkingLevel } from "../model-presets-config.ts";

const STATUS_KEY = "model-preset";
const PROVIDER = "openai-codex";

type Preset = (typeof MODEL_PRESETS)[number];

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

		const preset = findMatchingPreset(MODEL_PRESETS, model, thinkingLevel);
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
		const currentPreset = findMatchingPreset(MODEL_PRESETS, ctx.model, pi.getThinkingLevel());
		const labels = MODEL_PRESETS.map((preset) => {
			const active = preset === currentPreset ? " (active)" : "";
			return `${preset.name}${active} — ${preset.model} · ${preset.thinkingLevel} — ${preset.description}`;
		});
		const byLabel = new Map(labels.map((label, index) => [label, MODEL_PRESETS[index]]));
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

			const preset = MODEL_PRESETS.find((candidate) => candidate.name.toLowerCase() === requested);
			if (!preset) {
				ctx.ui.notify(`Unknown preset "${args.trim()}". Available: ${MODEL_PRESETS.map((item) => item.name).join(", ")}`, "error");
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
