import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { configLoader } from "./config.js";
import { executeAction } from "./tools/actions/index.js";
import { executeClear } from "./tools/actions/clear.js";
import { executeKill } from "./tools/actions/kill.js";
import { executeList } from "./tools/actions/list.js";
import { executeLogs } from "./tools/actions/logs.js";
import { executeOutput } from "./tools/actions/output.js";
import { executeStart } from "./tools/actions/start.js";
import type { ProcessInfo } from "./constants/index.js";

const makeProcess = (): ProcessInfo => ({
	id: "proc_1",
	name: "build",
	pid: 123,
	command: "echo hi",
	cwd: "/repo",
	startTime: 1,
	endTime: null,
	status: "exited",
	exitCode: 0,
	success: true,
	stdoutFile: "/tmp/out.log",
	stderrFile: "/tmp/err.log",
	alertOnSuccess: false,
	alertOnFailure: true,
	alertOnKill: false,
});

type ManagerMock = {
	list: () => ProcessInfo[];
	find: (id: string) => ProcessInfo | null;
	getOutput: (id: string, tailLines?: number) => { stdout: string[]; stderr: string[]; status: string } | null;
	getLogFiles: (id: string) => { stdoutFile: string; stderrFile: string } | null;
	start: (name: string, command: string, cwd: string, opts?: { alertOnSuccess?: boolean; alertOnFailure?: boolean; alertOnKill?: boolean }) => ProcessInfo;
	clearFinished: () => number;
	kill: (id: string, opts?: { signal?: NodeJS.Signals; timeoutMs?: number }) => Promise<{ ok: boolean; reason?: string; info: ProcessInfo }>;
};

const baseManager: ManagerMock = {
	list: () => [],
	find: () => null,
	getOutput: () => null,
	getLogFiles: () => null,
	start: () => makeProcess(),
	clearFinished: () => 0,
	kill: async () => ({ ok: false, reason: "not_found", info: makeProcess() }),
};

describe("process tools", () => {
	beforeEach(async () => {
		await configLoader.load();
		vi.restoreAllMocks();
	});
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("executeList handles zero and one process", () => {
		const empty = executeList({ ...baseManager, list: () => [] });
		expect(empty.content[0]?.text).toBe("No background processes running");
		expect(empty.details.processes).toEqual([]);

		const some = executeList({
			...baseManager,
			list: () => [
				{
					...makeProcess(),
					id: "proc_2",
					name: "test",
					status: "running",
					success: null,
					exitCode: null,
				},
			],
		});
		expect(some.content[0]?.text).toContain("1 process(es):");
		expect(some.details.processes).toHaveLength(1);
	});

	it("executeOutput validates input and missing process", () => {
		expect(executeOutput({}, baseManager).content[0]?.text).toBe("Missing required parameter: id");
		expect(executeOutput({ id: "nope" }, baseManager).content[0]?.text).toBe("Process not found: nope");
	});

	it("executeOutput strips ansi and formats text", () => {
		const manager: ManagerMock = {
			...baseManager,
			find: () => makeProcess(),
			getOutput: () => ({
				stdout: ["\u001b[31mred\u001b[0m", "ok"],
				stderr: ["\u001b[32mgreen\u001b[0m"],
				status: "exited",
			}),
			getLogFiles: () => ({ stdoutFile: "/tmp/out", stderrFile: "/tmp/err" }),
		};

		vi.spyOn(configLoader, "getConfig").mockReturnValue({
			processList: { maxVisibleProcesses: 8, maxPreviewLines: 12 },
			output: { defaultTailLines: 20, maxOutputLines: 20 },
			widget: { showStatusWidget: true },
		});

		const result = executeOutput({ id: "proc_1" }, manager);
		expect(result.content[0]?.text).toContain('"build" (proc_1) [exit(0)]: 2 stdout lines, 1 stderr lines');
		expect(result.content[0]?.text).toContain("red");
		expect(result.content[0]?.text).not.toContain("\u001b[");
	});

	it("executeOutput returns missing-output error", () => {
		const manager: ManagerMock = {
			...baseManager,
			find: () => makeProcess(),
			getOutput: () => null,
		};
		expect(executeOutput({ id: "proc_1" }, manager).content[0]?.text).toBe("Could not read output for: proc_1");
	});

	it("executeLogs validates and formats results", () => {
		expect(executeLogs({}, baseManager).content[0]?.text).toBe("Missing required parameter: id");
		expect(executeLogs({ id: "nope" }, baseManager).content[0]?.text).toBe("Process not found: nope");
		expect(
			executeLogs({ id: "proc_1" }, {
				...baseManager,
				find: () => makeProcess(),
				getLogFiles: () => null,
			}).content[0]?.text,
		).toBe("Could not get log files for: proc_1");

		expect(
			executeLogs(
				{ id: "proc_1" },
				{
					...baseManager,
					find: () => makeProcess(),
					getLogFiles: () => ({ stdoutFile: "/tmp/out", stderrFile: "/tmp/err" }),
				},
			).content[0]?.text,
		).toContain("Log files for \"build\" (proc_1)");
	});

	it("executeStart validates and calls manager.start", () => {
		const startMock = vi.fn().mockReturnValue(makeProcess());
		const manager = {
			...baseManager,
			start: startMock,
		} as unknown as ManagerMock;

		expect(executeStart({}, manager, { cwd: "/repo" } as ExtensionContext).content[0]?.text).toBe("Missing required parameter: name");
		expect(executeStart({ name: "build" }, manager, { cwd: "/repo" } as ExtensionContext).content[0]?.text).toBe(
			"Missing required parameter: command",
		);

		const result = executeStart(
			{ name: "build", command: "echo hi", alertOnSuccess: true },
			manager,
			{ cwd: "/repo" } as ExtensionContext,
		);
		expect(result.content[0]?.text).toContain('Started "build" (proc_1, PID: 123)');
		expect(startMock).toHaveBeenCalledWith("build", "echo hi", "/repo", {
			alertOnSuccess: true,
			alertOnFailure: undefined,
			alertOnKill: undefined,
		});
	});

	it("executeKill validates and reports all endings", async () => {
		const proc = makeProcess();
		expect((await executeKill({}, baseManager)).content[0]?.text).toBe("Missing required parameter: id");
		expect((await executeKill({ id: "nope" }, baseManager)).content[0]?.text).toBe("Process not found: nope");

		const ok = await executeKill({ id: proc.id }, { ...baseManager, find: () => proc, kill: vi.fn().mockResolvedValue({ ok: true, info: proc }) });
		expect(ok.content[0]?.text).toContain(`Terminated "${proc.name}" (${proc.id})`);

		const timeout = await executeKill({ id: proc.id }, {
			...baseManager,
			find: () => proc,
			kill: vi.fn().mockResolvedValue({ ok: false, reason: "timeout", info: proc }),
		});
		expect(timeout.content[0]?.text).toContain("SIGTERM timed out");

		const failed = await executeKill({ id: proc.id }, {
			...baseManager,
			find: () => proc,
			kill: vi.fn().mockResolvedValue({ ok: false, reason: "error", info: proc }),
		});
		expect(failed.content[0]?.text).toContain("Failed to terminate");
	});

	it("executeClear reports count", () => {
		expect(executeClear({ ...baseManager, clearFinished: () => 1 }).content[0]?.text).toBe("Cleared 1 finished process(es)");
	});

	it("executeAction dispatches all known actions", async () => {
		const proc = makeProcess();
		const manager: ManagerMock = {
			...baseManager,
			list: () => [proc],
			find: () => proc,
			getOutput: () => ({ stdout: ["one"], stderr: ["two"], status: "running" }),
			getLogFiles: () => ({ stdoutFile: "/tmp/o", stderrFile: "/tmp/e" }),
			start: () => proc,
			clearFinished: () => 3,
			kill: async () => ({ ok: true, info: proc }),
		};

		const start = await executeAction({ action: "start", name: "build", command: "echo hi" }, manager, { cwd: "/repo" } as ExtensionContext);
		expect(start.content[0]?.text).toContain("Started");

		const list = await executeAction({ action: "list" }, manager, { cwd: "/repo" } as ExtensionContext);
		expect(list.content[0]?.text).toContain("1 process(es):");

		const output = await executeAction({ action: "output", id: "proc_1" }, manager, { cwd: "/repo" } as ExtensionContext);
		expect(output.content[0]?.text).toContain('"build" (proc_1)');

		const logs = await executeAction({ action: "logs", id: "proc_1" }, manager, { cwd: "/repo" } as ExtensionContext);
		expect(logs.content[0]?.text).toContain("Log files for \"build\"");

		const kill = await executeAction({ action: "kill", id: "proc_1" }, manager, { cwd: "/repo" } as ExtensionContext);
		expect(kill.content[0]?.text).toContain('Terminated "build" (proc_1)');

		const clear = await executeAction({ action: "clear" }, manager, { cwd: "/repo" } as ExtensionContext);
		expect(clear.content[0]?.text).toBe("Cleared 3 finished process(es)");

		const unknown = await executeAction({ action: "bogus" }, manager, { cwd: "/repo" } as ExtensionContext);
		expect(unknown.content[0]?.text).toContain("Unknown action: bogus");
	});
});
