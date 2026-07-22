import assert from "node:assert/strict";
import test from "node:test";
import isolateExtension from "./index.ts";
import type { IsolationState, RepositoryInfo } from "./types.ts";

test("creates a worktree session and sends the isolated task with a unique job token", async () => {
	const harness = createHarness();
	isolateExtension(harness.api as any, harness.dependencies as any);

	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	assert.equal(harness.calls.created, 1);
	assert.equal(harness.calls.forked, 1);
	assert.equal(harness.calls.switches[0], harness.isolatedSessionFile);
	assert.match(harness.calls.kickoffs[0] ?? "", /Implement the feature/);
	assert.match(harness.calls.kickoffs[0] ?? "", /isolation job abcd1234/i);
	assert.equal(harness.state?.phase, "active");
});

test("initial manifest write failure clears the source pointer before returning", async () => {
	const harness = createHarness({ saveErrorOnCall: 1 });
	isolateExtension(harness.api as any, harness.dependencies as any);

	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	assert.equal(harness.calls.created, 0);
	assert.equal(harness.calls.cleaned, 1);
	assert.equal(harness.state, undefined);
	assert.equal(await harness.emitFirst("input", { text: "continue", source: "interactive" }, harness.sourceContext), undefined);
});

test("creation rollback failure shuts down even when cleanup state cannot be persisted", async () => {
	const harness = createHarness({
		saveErrorFromCall: 1,
		cleanupError: new Error("cleanup failed"),
	});
	isolateExtension(harness.api as any, harness.dependencies as any);

	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	assert.equal(harness.calls.created, 0);
	assert.equal(harness.calls.cleaned, 1);
	assert.equal(harness.calls.sourceShutdowns, 1);
});

test("the terminating finish tool signals the active driver, which integrates, returns, and cleans up before use", async () => {
	const harness = createHarness({ signalFinishDuringKickoff: true });
	isolateExtension(harness.api as any, harness.dependencies as any);

	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	assert.equal(harness.calls.integrated, 1);
	assert.equal(harness.calls.cleaned, 1);
	assert.deepEqual(harness.calls.switches, [harness.isolatedSessionFile, harness.sourceSessionFile]);
	assert.equal(harness.state, undefined);
	assert.equal(harness.calls.sourceShutdowns, 0);
	assert.match(harness.calls.finishResult?.content[0]?.text ?? "", /finishing after this turn/i);
	assert.equal(harness.calls.finishResult?.terminate, true);
});

test("finish tool in a recovered session prefills the explicit finish command instead of claiming an absent driver", async () => {
	const harness = createHarness();
	isolateExtension(harness.api as any, harness.dependencies as any);
	harness.state = harness.activeState();
	const finish = harness.tool("isolate_finish");

	const result = await finish.execute("finish-1", {}, undefined, undefined, harness.isolatedContext);

	assert.equal(harness.state?.phase, "finish_requested");
	assert.deepEqual(harness.calls.editorTexts, ["/isolate finish"]);
	assert.match(result.content[0].text, /prefilled/i);
});

test("fresh isolated extension instance recognizes the surviving automatic driver", async () => {
	const harness = createHarness({ signalFinishDuringKickoff: true, freshIsolatedExtension: true });
	isolateExtension(harness.api as any, harness.dependencies as any);

	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	assert.equal(harness.calls.integrated, 1);
	assert.equal(harness.calls.finishResult?.details.automatic, true);
	assert.deepEqual(harness.calls.editorTexts, []);
});

test("blocks manual session replacement while isolation is unresolved", async () => {
	const harness = createHarness();
	isolateExtension(harness.api as any, harness.dependencies as any);
	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	const result = await harness.emitFirst("session_before_switch", { reason: "resume", targetSessionFile: "/sessions/other.jsonl" }, harness.isolatedContext);
	assert.deepEqual(result, { cancel: true });
	assert.match(harness.calls.notifications.at(-1)?.message ?? "", /finish or discard/i);
});

test("cleanup failure leaves the manifest and shuts down the parent runtime before it becomes usable", async () => {
	const harness = createHarness({ signalFinishDuringKickoff: true, cleanupError: new Error("worktree is locked") });
	isolateExtension(harness.api as any, harness.dependencies as any);

	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	assert.equal(harness.state?.phase, "cleanup_pending");
	assert.match(harness.state?.lastError ?? "", /worktree is locked/i);
	assert.equal(harness.calls.sourceShutdowns, 1);
});

test("parent startup rolls back a crash during creation before allowing interaction", async () => {
	const harness = createHarness();
	isolateExtension(harness.api as any, harness.dependencies as any);
	harness.state = { ...harness.activeState(), phase: "creating", isolatedSessionFile: undefined };

	await harness.emitFirst("session_start", { reason: "startup" }, harness.sourceContext);

	assert.equal(harness.calls.cleaned, 1);
	assert.deepEqual(harness.calls.cleanupForces, [true]);
	assert.equal(harness.state, undefined);
	assert.equal(harness.calls.sourceShutdowns, 0);
});

test("parent startup shuts down while active isolated work is unresolved", async () => {
	const harness = createHarness();
	isolateExtension(harness.api as any, harness.dependencies as any);
	harness.state = harness.activeState();

	await harness.emitFirst("session_start", { reason: "startup" }, harness.sourceContext);

	assert.equal(harness.calls.sourceShutdowns, 1);
	assert.equal(harness.state?.phase, "active");
});

test("session pointer keeps the source governed when Git discovery fails", async () => {
	const harness = createHarness({ gitDiscoveryError: new Error("repository moved") });
	isolateExtension(harness.api as any, harness.dependencies as any);
	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	await harness.emitFirst("session_start", { reason: "startup" }, harness.sourceContext);

	assert.equal(harness.calls.sourceShutdowns, 1);
	assert.equal(harness.state?.phase, "active");
});

test("session pointer recovers a crash before the creating manifest is durable", async () => {
	const harness = createHarness({ gitDiscoveryError: new Error("repository moved") });
	isolateExtension(harness.api as any, harness.dependencies as any);
	harness.addPointer({ ...harness.activeState(), phase: "creating", isolatedSessionFile: undefined }, "active");
	harness.state = undefined;

	await harness.emitFirst("session_start", { reason: "startup" }, harness.sourceContext);

	assert.equal(harness.calls.cleaned, 1);
	assert.deepEqual(harness.calls.cleanupForces, [true]);
	assert.equal(harness.calls.sourceShutdowns, 0);
});

test("noninteractive source startup requests fatal process termination", async () => {
	const harness = createHarness();
	isolateExtension(harness.api as any, harness.dependencies as any);
	harness.state = harness.activeState();
	harness.sourceContext.mode = "rpc";

	await harness.emitFirst("session_start", { reason: "startup" }, harness.sourceContext);

	assert.equal(harness.calls.sourceShutdowns, 1);
	assert.equal(harness.calls.hardStops, 1);
});

test("non-interactive parent input and commands are blocked while isolation is unresolved", async () => {
	const harness = createHarness();
	isolateExtension(harness.api as any, harness.dependencies as any);
	harness.state = harness.activeState();
	harness.sourceContext.mode = "print";
	harness.sourceContext.hasUI = false;

	assert.deepEqual(
		await harness.emitFirst("input", { text: "do unsafe work", source: "rpc" }, harness.sourceContext),
		{ action: "handled" },
	);
	assert.deepEqual(
		await harness.emitFirst("tool_call", { toolName: "bash", input: { command: "touch unsafe" } }, harness.sourceContext),
		{ block: true, reason: "The original session is locked by unresolved Pi isolation." },
	);
	const bash = await harness.emitFirst("user_bash", { command: "touch unsafe" }, harness.sourceContext);
	assert.equal(bash.result.exitCode, 1);
});

test("switch cancellation with failed rollback shuts down the original runtime", async () => {
	const harness = createHarness({ cancelInitialSwitch: true, cleanupError: new Error("worktree is locked") });
	isolateExtension(harness.api as any, harness.dependencies as any);

	await harness.command("isolate").handler("Implement the feature", harness.sourceContext);

	assert.equal(harness.state?.phase, "cleanup_pending");
	assert.match(harness.state?.lastError ?? "", /worktree is locked/i);
	assert.equal(harness.calls.sourceShutdowns, 1);
});

test("stale finish cannot mutate or integrate a replacement isolation job", async () => {
	const harness = createHarness({ replaceStateOnLock: true });
	isolateExtension(harness.api as any, harness.dependencies as any);
	const stale = harness.activeState();
	harness.state = stale;

	await harness.command("isolate").handler("finish", {
		...harness.isolatedContext,
		sessionManager: {
			getSessionFile: () => stale.isolatedSessionFile,
			getEntries: () => harness.isolatedContext.sessionManager.getEntries(),
		},
	});

	assert.equal(harness.calls.integrated, 0);
	assert.equal(harness.state?.id, "replacement");
});

test("parent startup shuts down when the isolation manifest cannot be read safely", async () => {
	const harness = createHarness({ loadError: new Error("invalid isolation manifest") });
	isolateExtension(harness.api as any, harness.dependencies as any);

	await harness.emitFirst("session_start", { reason: "startup" }, harness.sourceContext);

	assert.equal(harness.calls.sourceShutdowns, 1);
	assert.match(harness.calls.notifications.at(-1)?.message ?? "", /invalid isolation manifest/i);
});

test("discard requires confirmation and never runs after integration", async () => {
	const cancelled = createHarness({ confirmDiscard: false });
	isolateExtension(cancelled.api as any, cancelled.dependencies as any);
	cancelled.state = cancelled.activeState();
	await cancelled.command("isolate").handler("discard", cancelled.isolatedContext);
	assert.equal(cancelled.calls.switches.length, 0);
	assert.equal(cancelled.calls.cleaned, 0);

	const integrated = createHarness({ confirmDiscard: true });
	isolateExtension(integrated.api as any, integrated.dependencies as any);
	integrated.state = { ...integrated.activeState(), phase: "integrated", integratedHead: "cafebabe" };
	await integrated.command("isolate").handler("discard", integrated.isolatedContext);
	assert.equal(integrated.calls.switches.length, 0);
	assert.match(integrated.calls.notifications.at(-1)?.message ?? "", /already integrated/i);
});

function createHarness(options: {
	signalFinishDuringKickoff?: boolean;
	cleanupError?: Error;
	confirmDiscard?: boolean;
	loadError?: Error;
	cancelInitialSwitch?: boolean;
	replaceStateOnLock?: boolean;
	gitDiscoveryError?: Error;
	freshIsolatedExtension?: boolean;
	saveErrorOnCall?: number;
	saveErrorFromCall?: number;
} = {}) {
	const sourceSessionFile = "/sessions/source.jsonl";
	const isolatedSessionFile = "/sessions/isolated.jsonl";
	const repository: RepositoryInfo = { root: "/repo", commonDir: "/repo/.git", branch: "main", head: "base0001" };
	const registeredCommands: Array<{ name: string; handler: (args: string, ctx: any) => Promise<void> }> = [];
	const registeredTools: Array<any> = [];
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const calls = {
		created: 0,
		forked: 0,
		integrated: 0,
		cleaned: 0,
		cleanupForces: [] as boolean[],
		switches: [] as string[],
		kickoffs: [] as string[],
		notifications: [] as Array<{ message: string; level: string }>,
		editorTexts: [] as string[],
		sourceShutdowns: 0,
		hardStops: 0,
		finishResult: undefined as any,
	};
	let state: IsolationState | undefined;
	let saveCalls = 0;
	const sessionEntries: Array<{ type: string; customType: string; data: unknown }> = [];
	let isolatedTools = registeredTools;

	const ui = {
		notify(message: string, level: string) {
			calls.notifications.push({ message, level });
		},
		setStatus() {},
		setEditorText(text: string) {
			calls.editorTexts.push(text);
		},
		async confirm() {
			return options.confirmDiscard ?? false;
		},
	};

	const sourceContext: any = {
		cwd: "/repo",
		hasUI: true,
		mode: "tui",
		ui,
		waitForIdle: async () => undefined,
		shutdown() {
			calls.sourceShutdowns++;
		},
		sessionManager: { getSessionFile: () => sourceSessionFile, getEntries: () => sessionEntries },
	};
	const isolatedContext: any = {
		cwd: "/repo/.worktrees/implement-the-feature-abcd1234",
		hasUI: true,
		mode: "tui",
		ui,
		waitForIdle: async () => undefined,
		shutdown() {},
		sessionManager: { getSessionFile: () => isolatedSessionFile, getEntries: () => sessionEntries },
	};

	const emitAll = async (event: string, payload: any, ctx: any) => {
		let result;
		for (const handler of handlers[event] ?? []) result = await handler(payload, ctx);
		return result;
	};

	const switchFrom = (context: any) => async (sessionFile: string, switchOptions?: { withSession?: (ctx: any) => Promise<void> }) => {
		calls.switches.push(sessionFile);
		if (options.cancelInitialSwitch && context === sourceContext && sessionFile === isolatedSessionFile) return { cancelled: true };
		const replacement = sessionFile === sourceSessionFile ? sourceContext : isolatedContext;
		if (options.freshIsolatedExtension && sessionFile === isolatedSessionFile) {
			const freshTools: Array<any> = [];
			isolateExtension({
				appendEntry: api.appendEntry,
				on() {},
				registerCommand() {},
				registerTool(tool: any) {
					freshTools.push(tool);
				},
			} as any, dependencies as any);
			isolatedTools = freshTools;
		}
		await emitAll("session_start", { reason: "resume" }, replacement);
		await switchOptions?.withSession?.(replacement);
		return { cancelled: false };
	};
	sourceContext.switchSession = switchFrom(sourceContext);
	isolatedContext.switchSession = switchFrom(isolatedContext);
	isolatedContext.sendUserMessage = async (message: string) => {
		calls.kickoffs.push(message);
		if (options.signalFinishDuringKickoff) {
			const finish = isolatedTools.find((tool) => tool.name === "isolate_finish");
			calls.finishResult = await finish.execute("finish-1", {}, undefined, undefined, isolatedContext);
		}
	};
	sourceContext.sendUserMessage = async () => undefined;

	const api = {
		appendEntry(customType: string, data: unknown) {
			sessionEntries.push({ type: "custom", customType, data });
		},
		on(event: string, handler: any) {
			handlers[event] ??= [];
			handlers[event].push(handler);
		},
		registerCommand(name: string, command: any) {
			registeredCommands.push({ name, ...command });
		},
		registerTool(tool: any) {
			registeredTools.push(tool);
		},
	};

	const activeState = (): IsolationState => ({
		version: 1,
		id: "abcd1234",
		phase: "active",
		task: "Implement the feature",
		createdAt: "2026-07-22T00:00:00.000Z",
		repositoryRoot: repository.root,
		gitCommonDir: repository.commonDir,
		baseBranch: repository.branch,
		baseHead: repository.head,
		sourceCwd: repository.root,
		sourceSessionFile,
		worktreePath: isolatedContext.cwd,
		worktreeCwd: isolatedContext.cwd,
		worktreeBranch: "pi-isolate/implement-the-feature-abcd1234",
		isolatedSessionFile,
	});

	const dependencies = {
		inspectRepository: async () => repository,
		findGitCommonDir: async () => {
			if (options.gitDiscoveryError) throw options.gitDiscoveryError;
			return repository.commonDir;
		},
		createWorktree: async () => {
			calls.created++;
		},
		integrateWorktree: async () => {
			calls.integrated++;
			return "cafebabe";
		},
		cleanupWorktree: async (_state: IsolationState, cleanupOptions: { force: boolean }) => {
			calls.cleaned++;
			calls.cleanupForces.push(cleanupOptions.force);
			if (options.cleanupError) throw options.cleanupError;
		},
		describeDiscard: async () => "1 unique commit will be deleted.\n\nUncommitted files:\n?? feature.txt",
		isWorkIntegrated: async () => false,
		loadIsolationState: async () => {
			if (options.loadError) throw options.loadError;
			return state;
		},
		saveIsolationState: async (next: IsolationState) => {
			saveCalls++;
			if (options.saveErrorOnCall === saveCalls || (options.saveErrorFromCall !== undefined && saveCalls >= options.saveErrorFromCall)) {
				throw new Error("manifest write failed");
			}
			state = structuredClone(next);
		},
		clearIsolationState: async () => {
			state = undefined;
		},
		withIsolationLock: async (_commonDir: string, operation: () => Promise<any>) => {
			if (options.replaceStateOnLock && state) {
				state = { ...state, id: "replacement", task: "Replacement" };
				options.replaceStateOnLock = false;
			}
			return await operation();
		},
		forkSession: () => {
			calls.forked++;
			return isolatedSessionFile;
		},
		createId: () => "abcd1234",
		now: () => new Date("2026-07-22T00:00:00.000Z"),
		terminateProcess: () => {
			calls.hardStops++;
		},
	};

	return {
		api,
		dependencies,
		calls,
		sourceContext,
		isolatedContext,
		sourceSessionFile,
		isolatedSessionFile,
		activeState,
		get state() {
			return state;
		},
		set state(next: IsolationState | undefined) {
			state = next;
		},
		addPointer(pointerState: IsolationState, status: "active" | "cleanup_verified" | "cleared") {
			sessionEntries.push({
				type: "custom",
				customType: "pi-isolate-job",
				data: {
					version: 1,
					id: pointerState.id,
					gitCommonDir: pointerState.gitCommonDir,
					status,
					state: structuredClone(pointerState),
				},
			});
		},
		command(name: string) {
			const command = registeredCommands.find((entry) => entry.name === name);
			assert.ok(command, `Missing /${name} command`);
			return command;
		},
		tool(name: string) {
			const tool = registeredTools.find((entry) => entry.name === name);
			assert.ok(tool, `Missing ${name} tool`);
			return tool;
		},
		async emitFirst(event: string, payload: any, ctx: any) {
			return await emitAll(event, payload, ctx);
		},
	};
}
