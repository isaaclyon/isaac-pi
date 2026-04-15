import { describe, expect, it, vi } from "vitest";

import { createMempalaceOperations } from "./operations.js";

function createRunner() {
	return vi.fn();
}

describe("createMempalaceOperations", () => {
	it("formats status results from the helper", async () => {
		const runHelper = createRunner().mockResolvedValue({
			ok: true,
			mempalaceAvailable: false,
			projectWing: "wing_repo",
			memoryRoot: "/repo/.pi/memory/mempalace",
			palaceRoot: "/repo/.pi/memory/mempalace/palace",
			lastSync: null,
			stats: {
				ingestFiles: 0,
				indexedItems: 0,
			},
		});
		const operations = createMempalaceOperations({ runHelper, now: () => "2026-04-10T12:34:56.000Z" });

		const result = await operations.getStatus({ cwd: "/repo" });

		expect(runHelper).toHaveBeenCalledWith("status", expect.objectContaining({
			projectRoot: "/repo",
			projectWing: "wing_repo",
			memoryRoot: "/repo/.pi/memory/mempalace",
		}));
		expect(result.isError).toBe(false);
		expect(result.content[0]?.text).toContain("Project memory: wing_repo");
		expect(result.content[0]?.text).toContain("MemPalace CLI: unavailable");
		expect(result.content[0]?.text).toContain("Indexed items: 0");
	});

	it("syncs only entries after the last synced branch entry", async () => {
		const runHelper = createRunner()
			.mockResolvedValueOnce({
				ok: true,
				mempalaceAvailable: true,
				projectWing: "wing_repo",
				memoryRoot: "/repo/.pi/memory/mempalace",
				palaceRoot: "/repo/.pi/memory/mempalace/palace",
				lastSync: {
					sessionFile: "/sessions/current.jsonl",
					entryId: "a1",
					timestamp: "2026-04-10T10:00:00.000Z",
				},
				stats: {
					ingestFiles: 1,
					indexedItems: 1,
				},
			})
			.mockResolvedValueOnce({
				ok: true,
				saved: true,
				indexedCount: 1,
				chunkPath: "/repo/.pi/memory/mempalace/ingest/pi-session/2026-04-10T12-34-56-000Z.json",
				rawOutput: "indexed",
			});
		const operations = createMempalaceOperations({ runHelper, now: () => "2026-04-10T12:34:56.000Z" });

		const result = await operations.sync({
			cwd: "/repo",
			sessionManager: {
				getSessionFile: () => "/sessions/current.jsonl",
				getBranch: () => [
					{
						type: "message",
						id: "u1",
						parentId: null,
						timestamp: "2026-04-10T10:00:00.000Z",
						message: { role: "user", content: "Old context" },
					},
					{
						type: "message",
						id: "a1",
						parentId: "u1",
						timestamp: "2026-04-10T10:00:01.000Z",
						message: { role: "assistant", content: [{ type: "text", text: "Old answer" }] },
					},
					{
						type: "message",
						id: "u2",
						parentId: "a1",
						timestamp: "2026-04-10T12:00:00.000Z",
						message: { role: "user", content: "Why did we switch auth?" },
					},
					{
						type: "message",
						id: "a2",
						parentId: "u2",
						timestamp: "2026-04-10T12:00:01.000Z",
						message: { role: "assistant", content: [{ type: "text", text: "We switched to Clerk for DX." }] },
					},
				],
			},
		});

		expect(runHelper).toHaveBeenNthCalledWith(2, "sync", expect.objectContaining({
			projectRoot: "/repo",
			chunk: expect.objectContaining({
				entryStartId: "u2",
				entryEndId: "a2",
				messages: [
					{ role: "user", text: "Why did we switch auth?" },
					{ role: "assistant", text: "We switched to Clerk for DX." },
				],
			}),
		}));
		expect(result.isError).toBe(false);
		expect(result.content[0]?.text).toContain("Synced 2 memory messages to wing_repo.");
		expect(result.content[0]?.text).toContain("indexed");
	});
});
