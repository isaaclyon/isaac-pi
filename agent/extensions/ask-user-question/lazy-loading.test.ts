import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const loadedUiModules: string[] = [];
const bun = (globalThis as typeof globalThis & {
	Bun: {
		file(path: string): { text(): Promise<string> };
		plugin(plugin: { name: string; setup(build: { onLoad(options: { filter: RegExp }, loader: (args: { path: string }) => Promise<{ contents: string; loader: "ts" }>): void }): void }): void;
	};
}).Bun;
bun.plugin({
	name: "track-questionnaire-ui-loads",
	setup(build) {
		build.onLoad({ filter: /state\/questionnaire-session\.ts$/ }, async ({ path }) => {
			loadedUiModules.push(path);
			return { contents: await bun.file(path).text(), loader: "ts" };
		});
	},
});

test("extension registration does not load the questionnaire UI graph", async () => {
	const extension = (await import(`./index.ts?lazy-registration=${Date.now()}`)).default;
	let registered = false;
	extension({
		registerTool() {
			registered = true;
		},
	} as unknown as ExtensionAPI);

	assert.equal(registered, true);
	assert.deepEqual(loadedUiModules, []);
});

type RegisteredTool = {
	execute(
		toolCallId: string,
		params: unknown,
		signal: AbortSignal | undefined,
		onUpdate: undefined,
		ctx: unknown,
	): Promise<{ content: Array<{ type: string; text: string }>; details: unknown }>;
};

const params = {
	questions: [
		{
			question: "Which runtime should we use?",
			header: "Runtime",
			options: [
				{ label: "Node", description: "Use Node.js" },
				{ label: "Bun", description: "Use Bun" },
			],
		},
	],
};

const answer = {
	answers: [
		{
			questionIndex: 0,
			question: params.questions[0]!.question,
			kind: "option" as const,
			answer: "Node",
		},
	],
	cancelled: false,
};

function createContext(): { ctx: unknown; rendererKinds: string[]; statuses: Array<string | undefined> } {
	const rendererKinds: string[] = [];
	const statuses: Array<string | undefined> = [];
	return {
		rendererKinds,
		statuses,
		ctx: {
			hasUI: true,
			ui: {
				notify() {},
				setStatus(_key: string, value?: string) {
					statuses.push(value);
				},
				async custom(renderer: (...args: unknown[]) => unknown) {
					rendererKinds.push(renderer.constructor.name);
					return answer;
				},
			},
		},
	};
}

async function registerTool(
	loader: () => Promise<typeof import("./state/questionnaire-session.ts")>,
): Promise<RegisteredTool> {
	const { registerAskUserQuestionTool } = await import("./ask-user-question.ts");
	let tool: RegisteredTool | undefined;
	registerAskUserQuestionTool(
		{
			registerTool(definition: unknown) {
				tool = definition as unknown as RegisteredTool;
			},
		} as unknown as ExtensionAPI,
		{ loadQuestionnaireSessionModule: loader },
	);
	assert.ok(tool);
	return tool;
}

test("first execution lazy-loads the UI and keeps the custom renderer synchronous", async () => {
	const { createQuestionnaireSessionModuleLoader } = await import("./ask-user-question.ts");
	let imports = 0;
	const tool = await registerTool(
		createQuestionnaireSessionModuleLoader(async () => {
			imports += 1;
			return import("./state/questionnaire-session.ts");
		}),
	);
	const { ctx, rendererKinds, statuses } = createContext();

	const result = await tool.execute("first", params, undefined, undefined, ctx);

	assert.equal(imports, 1);
	assert.equal(loadedUiModules.length, 1);
	assert.deepEqual(rendererKinds, ["Function"]);
	assert.match(result.content[0]!.text, /"Which runtime should we use\?"="Node"/);
	assert.equal(statuses.at(-1), undefined);
});

test("repeated and concurrent executions share one lazy import initialization", async () => {
	const { createQuestionnaireSessionModuleLoader } = await import("./ask-user-question.ts");
	let imports = 0;
	let releaseImport: (() => void) | undefined;
	const importGate = new Promise<void>((resolve) => {
		releaseImport = resolve;
	});
	const tool = await registerTool(
		createQuestionnaireSessionModuleLoader(async () => {
			imports += 1;
			await importGate;
			return import("./state/questionnaire-session.ts");
		}),
	);
	const executions = ["a", "b", "c"].map((id) => {
		const { ctx } = createContext();
		return tool.execute(id, params, undefined, undefined, ctx);
	});
	await Promise.resolve();
	assert.equal(imports, 1);
	releaseImport!();
	const results = await Promise.all(executions);
	assert.equal(imports, 1);
	assert.equal(results.length, 3);

	const { ctx } = createContext();
	await tool.execute("again", params, undefined, undefined, ctx);
	assert.equal(imports, 1);
});

test("lazy import failures reject as tool errors and remain cached", async () => {
	const { createQuestionnaireSessionModuleLoader } = await import("./ask-user-question.ts");
	let imports = 0;
	const tool = await registerTool(
		createQuestionnaireSessionModuleLoader(async () => {
			imports += 1;
			throw new Error("questionnaire UI import failed");
		}),
	);

	for (const id of ["failure-1", "failure-2"]) {
		const { ctx, statuses } = createContext();
		await assert.rejects(tool.execute(id, params, undefined, undefined, ctx), /questionnaire UI import failed/);
		assert.equal(statuses.at(-1), undefined);
	}
	assert.equal(imports, 1);
});
