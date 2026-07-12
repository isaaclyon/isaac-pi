import assert from "node:assert/strict";
import test from "node:test";
import modelNotFoundRetry from "./index.ts";

function createMockPi() {
	const handlers = new Map<string, Function[]>();
	return {
		on(event: string, handler: Function) {
			const eventHandlers = handlers.get(event) ?? [];
			eventHandlers.push(handler);
			handlers.set(event, eventHandlers);
		},
		handlers,
	};
}

async function handleMessage(message: Record<string, unknown>) {
	const pi = createMockPi();
	modelNotFoundRetry(pi as never);
	const handler = pi.handlers.get("message_end")?.[0];
	assert.ok(handler);
	return handler({ message }, {});
}

test("marks any model-not-found error as retryable", async () => {
	const message = {
		role: "assistant",
		stopReason: "error",
		errorMessage: "Error: Model not found gpt-5.6-luna",
		content: [],
	};

	const result = await handleMessage(message);

	assert.match(result.message.errorMessage, /Model not found gpt-5\.6-luna/);
	assert.match(result.message.errorMessage, /provider returned error/i);
	assert.notEqual(result.message, message);
});

test("matches model names without depending on a specific model", async () => {
	const result = await handleMessage({
		role: "assistant",
		stopReason: "error",
		errorMessage: "Model not found claude-sonnet-4",
	});

	assert.match(result.message.errorMessage, /provider returned error/i);
});

test("leaves unrelated messages unchanged", async () => {
	for (const message of [
		{ role: "user", stopReason: "error", errorMessage: "Model not found gpt-5.6-luna" },
		{ role: "assistant", stopReason: "stop", errorMessage: "Model not found gpt-5.6-luna" },
		{ role: "assistant", stopReason: "error", errorMessage: "Authentication failed" },
	]) {
		assert.equal(await handleMessage(message), undefined);
	}
});

test("does not append the retry marker twice", async () => {
	const message = {
		role: "assistant",
		stopReason: "error",
		errorMessage: "Model not found gpt-5.6-luna\n\n[model-not-found-retry] provider returned error",
	};

	assert.equal(await handleMessage(message), undefined);
});
