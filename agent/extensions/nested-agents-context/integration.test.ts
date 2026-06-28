import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_PI_PACKAGE = "/Users/isaaclyon/.local/share/fnm/node-versions/v26.2.0/installation/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.js";

async function loadPiRuntime() {
	const modulePath = process.env.PI_CODING_AGENT_DIST_INDEX ?? DEFAULT_PI_PACKAGE;
	if (!existsSync(modulePath)) {
		throw new Error(`Pi coding-agent dist index not found: ${modulePath}`);
	}
	return import(pathToFileURL(modulePath).href);
}

async function createRunner({ pi, cwd, extensionPath }) {
	const agentDir = join(cwd, ".agent");
	mkdirSync(agentDir);
	const extensionsResult = await pi.discoverAndLoadExtensions([extensionPath], cwd, agentDir, pi.createEventBus());
	assert.deepEqual(extensionsResult.errors, []);
	assert.equal(extensionsResult.extensions.length, 1);

	const runner = new pi.ExtensionRunner(
		extensionsResult.extensions,
		extensionsResult.runtime,
		cwd,
		pi.SessionManager.inMemory(cwd),
		{},
	);
	runner.setUIContext(undefined, "print");
	return runner;
}

test("live Pi extension runner loads nested context on the next before_agent_start", async () => {
	const pi = await loadPiRuntime();
	const extensionPath = dirname(fileURLToPath(import.meta.url));
	const cwd = mkdtempSync(join(tmpdir(), "nested-context-live-"));
	const sub = join(cwd, "sub");
	mkdirSync(sub);

	const rootAgents = join(cwd, "AGENTS.md");
	const subAgents = join(sub, "AGENTS.md");
	writeFileSync(rootAgents, "root startup rules");
	writeFileSync(subAgents, "sub live rules");
	writeFileSync(join(sub, "file.ts"), "export {};\n");

	const runner = await createRunner({ pi, cwd, extensionPath });
	await runner.emit({ type: "session_start", reason: "startup" });

	const beforeAccess = await runner.emitBeforeAgentStart("prompt", undefined, "BASE", {
		cwd,
		contextFiles: [{ path: rootAgents, content: "root startup rules" }],
	});
	assert.equal(beforeAccess, undefined);

	await runner.emit({
		type: "tool_execution_start",
		toolCallId: "tool-1",
		toolName: "read",
		args: { path: "sub/file.ts" },
	});

	const afterAccess = await runner.emitBeforeAgentStart("prompt", undefined, "BASE", {
		cwd,
		contextFiles: [{ path: rootAgents, content: "root startup rules" }],
	});

	assert.equal(typeof afterAccess?.systemPrompt, "string");
	assert.match(afterAccess.systemPrompt, /<project_context>/);
	const realSubAgents = realpathSync.native(subAgents);
	assert.match(afterAccess.systemPrompt, new RegExp(`<project_instructions path="${realSubAgents.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}">`));
	assert.match(afterAccess.systemPrompt, /sub live rules/);
	assert.doesNotMatch(afterAccess.systemPrompt, /root startup rules/);
});
