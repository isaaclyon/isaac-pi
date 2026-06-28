import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import nestedAgentsContext from "./index.ts";

function createMockPi() {
	const handlers = new Map<string, Function[]>();
	return {
		on(event: string, handler: Function) {
			const eventHandlers = handlers.get(event) ?? [];
			eventHandlers.push(handler);
			handlers.set(event, eventHandlers);
		},
		async emit(event: string, payload: unknown, ctx: unknown = {}) {
			let result;
			for (const handler of handlers.get(event) ?? []) {
				result = await handler(payload, ctx);
			}
			return result;
		},
		handlers,
	};
}

function occurrences(text: string, needle: string) {
	return text.split(needle).length - 1;
}

test("extension loads typed-tool nested instructions and injects them without duplicating startup context", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "nested-context-extension-"));
	const sub = join(cwd, "sub");
	mkdirSync(sub);
	const rootAgents = join(cwd, "AGENTS.md");
	const subAgents = join(sub, "AGENTS.md");
	writeFileSync(rootAgents, "root rules");
	writeFileSync(subAgents, "sub rules");
	writeFileSync(join(sub, "file.ts"), "export {};\n");

	const pi = createMockPi();
	nestedAgentsContext(pi as never);
	const ctx = { cwd };

	await pi.emit("session_start", {}, ctx);
	assert.equal(await pi.emit("before_agent_start", {
		systemPrompt: "BASE",
		systemPromptOptions: { contextFiles: [{ path: rootAgents, content: "root rules" }] },
	}), undefined);

	await pi.emit("tool_execution_start", { toolCallId: "1", toolName: "read", args: { path: "sub/file.ts" } }, ctx);
	await pi.emit("tool_execution_start", { toolCallId: "2", toolName: "read", args: { path: "sub/file.ts" } }, ctx);

	const result = await pi.emit("before_agent_start", {
		systemPrompt: "BASE",
		systemPromptOptions: { contextFiles: [{ path: rootAgents, content: "root rules" }] },
	});

	assert.equal(typeof result?.systemPrompt, "string");
	assert.equal(occurrences(result.systemPrompt, rootAgents), 0);
	assert.equal(occurrences(result.systemPrompt, subAgents), 1);
	assert.match(result.systemPrompt, /sub rules/);
	assert.match(result.systemPrompt, /<project_context>/);
});

test("extension ignores bash command text and paths outside cwd", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "nested-context-extension-cwd-"));
	const sub = join(cwd, "sub");
	const outside = mkdtempSync(join(tmpdir(), "nested-context-extension-outside-"));
	mkdirSync(sub);
	writeFileSync(join(sub, "AGENTS.md"), "sub rules");
	writeFileSync(join(outside, "AGENTS.md"), "outside rules");

	const pi = createMockPi();
	nestedAgentsContext(pi as never);
	const ctx = { cwd };
	await pi.emit("session_start", {}, ctx);
	await pi.emit("tool_execution_start", { toolCallId: "1", toolName: "bash", args: { command: "cat sub/AGENTS.md" } }, ctx);
	await pi.emit("tool_execution_start", { toolCallId: "2", toolName: "read", args: { path: join(outside, "file.ts") } }, ctx);

	const result = await pi.emit("before_agent_start", { systemPrompt: "BASE", systemPromptOptions: { contextFiles: [] } });
	assert.equal(result, undefined);
});

test("extension filters loaded nested files that become base context", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "nested-context-extension-base-"));
	const sub = join(cwd, "sub");
	mkdirSync(sub);
	const subAgents = join(sub, "AGENTS.md");
	writeFileSync(subAgents, "sub rules");
	writeFileSync(join(sub, "file.ts"), "export {};\n");

	const pi = createMockPi();
	nestedAgentsContext(pi as never);
	const ctx = { cwd };
	await pi.emit("session_start", {}, ctx);
	await pi.emit("tool_execution_start", { toolCallId: "1", toolName: "read", args: { path: "sub/file.ts" } }, ctx);

	const result = await pi.emit("before_agent_start", {
		systemPrompt: "BASE",
		systemPromptOptions: { contextFiles: [{ path: realpathSync.native(subAgents), content: "sub rules" }] },
	});
	assert.equal(result, undefined);
});

test("extension resets loaded instructions on session and compaction lifecycle events", async () => {
	for (const eventName of ["session_start", "session_tree", "session_before_compact", "session_compact", "session_shutdown"]) {
		const cwd = mkdtempSync(join(tmpdir(), `nested-context-extension-reset-${eventName}-`));
		const sub = join(cwd, "sub");
		mkdirSync(sub);
		writeFileSync(join(sub, "AGENTS.md"), "sub rules");
		writeFileSync(join(sub, "file.ts"), "export {};\n");

		const pi = createMockPi();
		nestedAgentsContext(pi as never);
		const ctx = { cwd };
		await pi.emit("session_start", {}, ctx);
		await pi.emit("tool_execution_start", { toolCallId: "1", toolName: "read", args: { path: "sub/file.ts" } }, ctx);
		await pi.emit(eventName, {}, ctx);

		const result = await pi.emit("before_agent_start", { systemPrompt: "BASE", systemPromptOptions: { contextFiles: [] } });
		assert.equal(result, undefined, `${eventName} should clear loaded nested context`);
	}
});
