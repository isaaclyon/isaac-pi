import type { Api, Context, Model } from "@mariozechner/pi-ai";
import type { AssistantMessage } from "@mariozechner/pi-ai";

export type LcmSummarizer = (input: string) => Promise<string>;

type StreamSimpleFn = (model: Model<Api>, context: Context) => { result(): Promise<AssistantMessage> };

const SYSTEM_PROMPT =
	"You are a precise conversation summarizer. " +
	"Given a structured summary of a conversation chunk, produce a concise semantic summary that preserves key facts, decisions, code changes, and outcomes. " +
	"Output only the summary text. No preamble, no meta-commentary.";

/**
 * Creates an LcmSummarizer that calls the model via streamSimple.
 *
 * The returned function accepts structural summary text as input (already formatted
 * by the rule-based pass) and returns a semantic summary from the model.
 * Falls back to the structural input on any error (fail-open).
 *
 * @param streamSimple - the streamSimple function from @mariozechner/pi-ai
 * @param model        - the Model<Api> to call
 */
export function createLlmSummarizer(streamSimple: StreamSimpleFn, model: Model<Api>): LcmSummarizer {
	return async (input: string): Promise<string> => {
		try {
			const context: Context = {
				systemPrompt: SYSTEM_PROMPT,
				messages: [
					{
						role: "user",
						content: input,
						timestamp: Date.now(),
					},
				],
			};

			const stream = streamSimple(model, context);
			const message = await stream.result();

			const content = message?.content ?? [];
			const text = content
				.filter((block) => block.type === "text")
				.map((block) => (block as { type: "text"; text: string }).text)
				.join("\n")
				.trim();

			return text || input; // fallback to structural if model returns empty
		} catch {
			return input; // fail-open: structural summary survives any error
		}
	};
}
