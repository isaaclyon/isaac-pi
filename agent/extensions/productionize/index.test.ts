import assert from "node:assert/strict";
import test from "node:test";
import productionizeExtension from "./index.ts";
import { createDefaultSnapshot } from "./auto.ts";

function createMockExtensionApi() {
	const registeredTools: Array<any> = [];
	const registeredCommands: Array<any> = [];
	const registeredEventHandlers: Record<string, Array<any>> = {};
	const sentUserMessages: string[] = [];
	const sentMessages: Array<any> = [];
	return {
		registeredTools,
		registeredCommands,
		registeredEventHandlers,
		sentUserMessages,
		sentMessages,
		api: {
			on(event: string, handler: any) {
				registeredEventHandlers[event] ??= [];
				registeredEventHandlers[event].push(handler);
			},
			registerTool(tool: any) {
				registeredTools.push(tool);
			},
			registerCommand(name: string, command: any) {
				registeredCommands.push({ name, ...command });
			},
			sendUserMessage(message: string) {
				sentUserMessages.push(message);
			},
			sendMessage(message: any, options?: any) {
				sentMessages.push({ message, options });
			},
			appendEntry() {},
		} as any,
	};
}

function createToolContext(entries: Array<any> = []) {
	const statuses: Array<string | undefined> = [];
	return {
		ctx: {
			cwd: "/repo",
			hasUI: true,
			waitForIdle: async () => undefined,
			ui: {
				setStatus(_key: string, value?: string) {
					statuses.push(value);
				},
				notify() {},
			},
			sessionManager: {
				getSessionFile: () => "/tmp/session.jsonl",
				getEntries: () => entries,
			},
		} as any,
		statuses,
	};
}

test("productionize_run is registered with async no-poll guidance", () => {
	const mock = createMockExtensionApi();
	productionizeExtension(mock.api as any);

	const tool = mock.registeredTools.find((entry) => entry.name === "productionize_run");
	assert.ok(tool);
	assert.match(tool.description, /returns immediately/i);
	assert.match(tool.description, /Do not poll for status/i);
	assert.match(tool.description, /fix it in-band/i);
	assert.match(tool.description, /Do not use side sessions/i);

	const rendered = tool.renderResult({ content: [], details: { status: "started" } });
	assert.equal(typeof rendered.invalidate, "function");
	assert.deepEqual(rendered.render(80), ["productionize_run — started"]);

	assert.deepEqual(
		tool.renderResult({ content: [], details: { status: "already_running" } }).render(80),
		["productionize_run — already running"],
	);
	assert.deepEqual(
		tool.renderResult({ content: [{ type: "text", text: "fallback" }], details: {} }).render(80),
		["fallback"],
	);
});

test("productionize_run starts immediately, resumes failed state, and steers completion", async () => {
	const mock = createMockExtensionApi();
	let seenState: any;
	let resolver: (() => void) | undefined;
	const finished = new Promise<void>((resolve) => {
		resolver = resolve;
	});
	const failed = createDefaultSnapshot(true);
	failed.outcome = "failed";
	failed.status = "Productionize failed during CI Checks.";
	failed.auto.activeCheckpoint = "ci";
	failed.auto.resumeFromCheckpoint = "ci";
	failed.failure = { step: "CI Checks", message: "Tests failed" };

	productionizeExtension(mock.api as any, {
		reconstructAutoState: () => ({ state: failed }),
		prepareStateForModelRun: (state) => {
			const next = createDefaultSnapshot(true);
			next.outcome = "running";
			next.status = "Resuming productionize from ci...";
			next.auto.resumeFromCheckpoint = state.auto.resumeFromCheckpoint;
			return next;
		},
		createInitialState: () => createDefaultSnapshot(true),
		buildProductionizeFailurePrompt: () => "failure",
		buildProductionizeCompletionMessage: (state) => `done:${state.outcome}:${state.status}`,
		async runWorkflow(_pi, _ctx, state, _signal, render) {
			seenState = state;
			render();
			state.outcome = "succeeded";
			state.status = "Productionize completed.";
			resolver?.();
		},
	});

	const tool = mock.registeredTools.find((entry) => entry.name === "productionize_run");
	const { ctx, statuses } = createToolContext();
	const result = await tool.execute("tool-1", {}, undefined, undefined, ctx);

	assert.equal(result.details.status, "started");
	assert.equal(seenState.auto.resumeFromCheckpoint, "ci");
	assert.equal(seenState.failure, undefined);
	assert.equal(statuses[0], "Resuming productionize from ci...");

	await finished;
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(statuses.at(-1), undefined);
	assert.equal(mock.sentMessages.length, 1);
	assert.equal(mock.sentMessages[0].options.triggerTurn, true);
	assert.equal(mock.sentMessages[0].options.deliverAs, "steer");
	assert.match(mock.sentMessages[0].message.content, /done:succeeded:Productionize completed\./);
});

test("productionize_run passes targetStep scope through to workflow", async () => {
	const mock = createMockExtensionApi();
	let seenOptions: any;
	productionizeExtension(mock.api as any, {
		reconstructAutoState: () => ({}),
		prepareStateForModelRun: (state) => state,
		createInitialState: (options) => {
			const state = createDefaultSnapshot(true);
			state.auto.resumeFromCheckpoint = options.stopAfter;
			return state;
		},
		buildProductionizeFailurePrompt: () => "failure",
		buildProductionizeCompletionMessage: () => "done",
		async runWorkflow(_pi, _ctx, state, _signal, _render, options) {
			seenOptions = options;
			state.outcome = "succeeded";
		},
	});

	const tool = mock.registeredTools.find((entry) => entry.name === "productionize_run");
	const result = await tool.execute("tool-1", { targetStep: "ci" }, undefined, undefined, createToolContext().ctx);

	assert.equal(result.details.status, "started");
	await new Promise((resolve) => setImmediate(resolve));
	assert.deepEqual(seenOptions, { auto: true, startFrom: "branch", stopAfter: "ci" });
});

test("productionize_run rejects duplicate active runs", async () => {
	const mock = createMockExtensionApi();
	let release!: () => void;
	const blocker = new Promise<void>((resolve) => {
		release = resolve;
	});
	productionizeExtension(mock.api as any, {
		reconstructAutoState: () => ({}),
		prepareStateForModelRun: (state) => state,
		createInitialState: () => createDefaultSnapshot(true),
		buildProductionizeFailurePrompt: () => "failure",
		buildProductionizeCompletionMessage: () => "done",
		runWorkflow: async () => blocker,
	});

	const tool = mock.registeredTools.find((entry) => entry.name === "productionize_run");
	const firstCtx = createToolContext().ctx;
	const secondCtx = createToolContext().ctx;
	const first = await tool.execute("tool-1", {}, undefined, undefined, firstCtx);
	const second = await tool.execute("tool-2", {}, undefined, undefined, secondCtx);

	assert.equal(first.details.status, "started");
	assert.equal(second.details.status, "already_running");
	assert.match(second.content[0].text, /already running/i);
	release();
	await new Promise((resolve) => setImmediate(resolve));
});

test("productionize_run relays caller cancellation to the background workflow", async () => {
	const mock = createMockExtensionApi();
	const controller = new AbortController();
	let workflowSignal!: AbortSignal;
	let release!: () => void;
	const finished = new Promise<void>((resolve) => {
		release = resolve;
	});
	productionizeExtension(mock.api as any, {
		reconstructAutoState: () => ({}),
		prepareStateForModelRun: (state) => state,
		createInitialState: () => createDefaultSnapshot(true),
		buildProductionizeFailurePrompt: () => "failure",
		buildProductionizeCompletionMessage: () => "done",
		runWorkflow: async (_pi, _ctx, _state, signal) => {
			workflowSignal = signal;
			if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
			release();
		},
	});

	const tool = mock.registeredTools.find((entry) => entry.name === "productionize_run");
	const result = await tool.execute("tool-1", {}, controller.signal, undefined, createToolContext().ctx);
	assert.equal(result.details.status, "started");

	controller.abort();
	await finished;
	assert.equal(workflowSignal.aborted, true);
});
