import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { clearIsolationState, isolationStatePath, loadIsolationState, saveIsolationState, withIsolationLock } from "./state.ts";
import type { IsolationState } from "./types.ts";

test("isolation state round-trips atomically under the Git common directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-isolate-state-"));
	try {
		const state = createState(root);
		await saveIsolationState(state);

		assert.deepEqual(await loadIsolationState(root), state);
		assert.equal(isolationStatePath(root), join(root, "pi-isolate", "state.json"));
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("clearing isolation state is idempotent", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-isolate-state-"));
	try {
		await saveIsolationState(createState(root));
		await clearIsolationState(root);
		await clearIsolationState(root);
		assert.equal(await loadIsolationState(root), undefined);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects a manifest that redirects ownership to another Git common directory", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-isolate-state-"));
	try {
		const state = createState(root);
		await saveIsolationState(state);
		await writeFile(isolationStatePath(root), `${JSON.stringify({ ...state, gitCommonDir: join(root, "other") })}\n`);
		await assert.rejects(() => loadIsolationState(root), /does not match/i);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("rejects incomplete or incorrectly typed lifecycle fields", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-isolate-state-"));
	try {
		const state = createState(root);
		const invalid = { ...state, baseHead: undefined, driverToken: 42 };
		await saveIsolationState(state);
		await writeFile(isolationStatePath(root), `${JSON.stringify(invalid)}\n`);
		await assert.rejects(() => loadIsolationState(root), /invalid pi isolation state/i);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test("repository transition lock rejects concurrent isolation mutations and releases afterward", async () => {
	const root = await mkdtemp(join(tmpdir(), "pi-isolate-state-"));
	try {
		let release!: () => void;
		let markEntered!: () => void;
		const blocked = new Promise<void>((resolve) => {
			release = resolve;
		});
		const entered = new Promise<void>((resolve) => {
			markEntered = resolve;
		});
		const first = withIsolationLock(root, async () => {
			markEntered();
			await blocked;
			return "first";
		});
		await entered;

		await assert.rejects(() => withIsolationLock(root, async () => "second"), /already in progress/i);
		release();
		assert.equal(await first, "first");
		assert.equal(await withIsolationLock(root, async () => "third"), "third");
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

function createState(commonDir: string): IsolationState {
	return {
		version: 1,
		id: "abcd1234",
		phase: "active",
		task: "Implement isolation",
		createdAt: "2026-07-22T00:00:00.000Z",
		repositoryRoot: "/repo",
		gitCommonDir: commonDir,
		baseBranch: "main",
		baseHead: "deadbeef",
		sourceCwd: "/repo",
		sourceSessionFile: "/sessions/source.jsonl",
		worktreePath: "/repo/.worktrees/isolation",
		worktreeCwd: "/repo/.worktrees/isolation",
		worktreeBranch: "pi-isolate/isolation-abcd1234",
		isolatedSessionFile: "/sessions/isolated.jsonl",
	};
}
