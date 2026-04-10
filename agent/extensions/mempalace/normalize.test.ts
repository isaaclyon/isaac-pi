import { describe, expect, it } from "vitest";

import { buildSyncChunk, type SessionBranchEntry } from "./normalize.js";

function messageEntry(id: string, message: Record<string, unknown>): SessionBranchEntry {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-04-10T00:00:00.000Z",
		message,
	} as SessionBranchEntry;
}

describe("buildSyncChunk", () => {
	it("builds a chunk from entries after the last synced entry", () => {
		const entries: SessionBranchEntry[] = [
			messageEntry("u1", { role: "user", content: "Old question" }),
			messageEntry("a1", {
				role: "assistant",
				content: [{ type: "text", text: "Old answer" }],
			}),
			messageEntry("u2", { role: "user", content: "Why did auth fail in staging?" }),
			messageEntry("a2", {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "hidden" },
					{ type: "text", text: "Likely a stale webhook secret." },
				],
			}),
			messageEntry("t1", {
				role: "toolResult",
				toolName: "grep",
				content: [{ type: "text", text: "Found AUTH_WEBHOOK_SECRET in src/auth/webhooks.ts" }],
				isError: false,
			}),
			{
				type: "custom",
				id: "c1",
				parentId: null,
				timestamp: "2026-04-10T00:00:00.000Z",
				customType: "other-extension",
				data: { ignored: true },
			} as SessionBranchEntry,
		];

		const chunk = buildSyncChunk({
			branchEntries: entries,
			projectRoot: "/repo",
			projectWing: "wing_repo",
			sessionFile: "/sessions/current.jsonl",
			lastSyncedEntryId: "a1",
			now: "2026-04-10T12:34:56.000Z",
		});

		expect(chunk).toEqual({
			source: "pi-session",
			sessionFile: "/sessions/current.jsonl",
			entryStartId: "u2",
			entryEndId: "t1",
			projectRoot: "/repo",
			projectWing: "wing_repo",
			createdAt: "2026-04-10T12:34:56.000Z",
			messages: [
				{ role: "user", text: "Why did auth fail in staging?" },
				{ role: "assistant", text: "Likely a stale webhook secret." },
				{
					role: "toolResult",
					toolName: "grep",
					text: "Found AUTH_WEBHOOK_SECRET in src/auth/webhooks.ts",
				},
			],
			metadata: {
				filesTouched: ["src/auth/webhooks.ts"],
				gitBranch: null,
			},
		});
	});

	it("includes assistant messages when the content is a plain string", () => {
		const entries: SessionBranchEntry[] = [
			messageEntry("a1", { role: "assistant", content: "Plain string answer" }),
		];

		const chunk = buildSyncChunk({
			branchEntries: entries,
			projectRoot: "/repo",
			projectWing: "wing_repo",
			sessionFile: "/sessions/current.jsonl",
			now: "2026-04-10T12:34:56.000Z",
		});

		expect(chunk?.messages).toEqual([{ role: "assistant", text: "Plain string answer" }]);
	});

	it("extracts extensionless file references from quoted or backticked tool output", () => {
		const entries: SessionBranchEntry[] = [
			messageEntry("t1", {
				role: "toolResult",
				toolName: "read",
				content: [{ type: "text", text: 'Touched `README` and "src/auth" while debugging.' }],
				isError: false,
			}),
		];

		const chunk = buildSyncChunk({
			branchEntries: entries,
			projectRoot: "/repo",
			projectWing: "wing_repo",
			sessionFile: "/sessions/current.jsonl",
			now: "2026-04-10T12:34:56.000Z",
		});

		expect(chunk?.metadata.filesTouched).toEqual(["README", "src/auth"]);
	});

	it("returns null when there is nothing new to sync", () => {
		const entries: SessionBranchEntry[] = [
			messageEntry("u1", { role: "user", content: "Only message" }),
		];

		const chunk = buildSyncChunk({
			branchEntries: entries,
			projectRoot: "/repo",
			projectWing: "wing_repo",
			sessionFile: "/sessions/current.jsonl",
			lastSyncedEntryId: "u1",
			now: "2026-04-10T12:34:56.000Z",
		});

		expect(chunk).toBeNull();
	});
});
