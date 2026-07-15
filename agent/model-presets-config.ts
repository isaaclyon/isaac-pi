export type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

interface ModelPreset {
	name: string;
	model: string;
	thinkingLevel: ThinkingLevel;
	description: string;
}

export const MODEL_PRESETS = [
	{
		name: "Maintainer",
		model: "gpt-5.6-luna",
		thinkingLevel: "medium",
		description: "Git, commits, exploration, and routine repo work",
	},
	{
		name: "Implementer",
		model: "gpt-5.6-luna",
		thinkingLevel: "high",
		description: "Main workhorse for building and feature work",
	},
	{
		name: "Expert",
		model: "gpt-5.6-sol",
		thinkingLevel: "medium",
		description: "Tasks beyond routine implementation",
	},
	{
		name: "Architect",
		model: "gpt-5.6-sol",
		thinkingLevel: "high",
		description: "Complex design and high-stakes changes",
	},
] as const satisfies readonly ModelPreset[];
