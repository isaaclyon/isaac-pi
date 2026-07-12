import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const MODEL_NOT_FOUND_RE = /\bmodel\s+not\s+found\b/i;
const RETRY_MARKER = "[model-not-found-retry]";

/**
 * Pi's built-in retry classifier does not currently recognize Codex's
 * transient model lookup failure. Add its existing retry phrase to matching
 * assistant errors so Pi can handle the retry budget and backoff normally.
 */
export default function modelNotFoundRetry(pi: ExtensionAPI): void {
	pi.on("message_end", (event) => {
		if (event.message.role !== "assistant" || event.message.stopReason !== "error") return;

		const errorMessage = event.message.errorMessage;
		if (
			typeof errorMessage !== "string" ||
			!MODEL_NOT_FOUND_RE.test(errorMessage) ||
			errorMessage.includes(RETRY_MARKER)
		) {
			return;
		}

		return {
			message: {
				...event.message,
				errorMessage: `${errorMessage}\n\n${RETRY_MARKER} provider returned error; treating model lookup failure as retryable.`,
			},
		};
	});
}
