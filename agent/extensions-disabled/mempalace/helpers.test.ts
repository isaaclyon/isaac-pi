import { describe, expect, it } from "vitest";

import { createHelperRunner } from "./helpers.js";

type SpawnRecord = {
	command: string;
	args: string[];
	stdin: string;
};

describe("createHelperRunner", () => {
	it("runs a helper via uv and parses JSON output", async () => {
		const calls: SpawnRecord[] = [];
		const runner = createHelperRunner({
			spawn(command, args, stdin) {
				calls.push({ command, args, stdin });
				return Promise.resolve({
					code: 0,
					stdout: JSON.stringify({ ok: true, helper: "status" }),
					stderr: "",
				});
			},
		});

		const result = await runner("status", { projectRoot: "/repo" });

		expect(result).toEqual({ ok: true, helper: "status" });
		expect(calls).toHaveLength(1);
		expect(calls[0]).toEqual({
			command: "uv",
			args: expect.arrayContaining(["run", expect.stringContaining("helpers/status.py")]),
			stdin: JSON.stringify({ projectRoot: "/repo" }),
		});
	});

	it("throws a detailed error when the helper exits non-zero", async () => {
		const runner = createHelperRunner({
			spawn() {
				return Promise.resolve({
					code: 2,
					stdout: "",
					stderr: "boom",
				});
			},
		});

		await expect(runner("sync", { projectRoot: "/repo" })).rejects.toThrow(
			"MemPalace helper 'sync' failed with exit code 2: boom",
		);
	});
});
