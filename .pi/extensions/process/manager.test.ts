import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import * as processGroup from "./utils/process-group.js";
import { ProcessManager } from "./manager.js";

interface FakeStream extends PassThrough {
	write: PassThrough["write"];
}

interface FakeChild extends EventEmitter {
	pid: number;
	unref: () => void;
	stdout: FakeStream;
	stderr: FakeStream;
}

const children: FakeChild[] = [];
let spyIsAlive: any;
let spyKillGroup: any;
const spawnMock = vi.fn(() => {
	const child = new EventEmitter() as FakeChild;
	child.pid = 200 + children.length;
	child.unref = vi.fn();
	child.stdout = new PassThrough() as FakeStream;
	child.stderr = new PassThrough() as FakeStream;
	children.push(child);
	return child;
});


vi.mock("node:child_process", async () => {
	const actual = await vi.importActual<typeof import("node:child_process")>(
		"node:child_process",
	);
	return {
		...actual,
		spawn: (..._args: unknown[]) => spawnMock(..._args),
	};
});

describe("ProcessManager", () => {
	beforeEach(() => {
		spawnMock.mockReset();
		children.length = 0;
		spyIsAlive = vi.spyOn(processGroup, "isProcessGroupAlive").mockReturnValue(false);
		spyKillGroup = vi.spyOn(processGroup, "killProcessGroup").mockImplementation(() => {
			return;
		});
		spawnMock.mockImplementation(() => {
			const child = new EventEmitter() as FakeChild;
			child.pid = 200 + children.length;
			child.unref = vi.fn();
			child.stdout = new PassThrough() as FakeStream;
			child.stderr = new PassThrough() as FakeStream;
			children.push(child);
			return child;
		});
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("starts a process and emits process_started", () => {
		const manager = new ProcessManager();
		const events: string[] = [];
		manager.onEvent((event) => {
			events.push(event.type);
		});

		const proc = manager.start("build", "echo hi", "/repo", {
			alertOnSuccess: true,
			alertOnFailure: false,
			alertOnKill: true,
		});

		expect(spawnMock).toHaveBeenCalledWith(
			"/bin/bash",
			["-lc", "echo hi"],
			expect.objectContaining({
				cwd: "/repo",
				stdio: ["ignore", "pipe", "pipe"],
				detached: true,
			}),
		);
		expect(children).toHaveLength(1);
		expect(children[0]!.unref).toHaveBeenCalledTimes(1);
		expect(proc.id).toBe("proc_1");
		expect(proc.name).toBe("build");
		expect(proc.alertOnFailure).toBe(false);
		expect(events[0]).toBe("process_started");
		manager.cleanup();
	});

	it("falls back when spawn returns no pid", () => {
		spawnMock.mockImplementationOnce(() => {
			const child = new EventEmitter() as FakeChild;
			child.pid = 0 as never;
			child.unref = vi.fn();
			child.stdout = new PassThrough() as FakeStream;
			child.stderr = new PassThrough() as FakeStream;
			children.push(child);
			return child;
		});

		const manager = new ProcessManager();
		const proc = manager.start("bad", "echo", "/repo");
		expect(proc.status).toBe("exited");
		expect(proc.exitCode).toBe(-1);
		expect(proc.success).toBe(false);
		manager.cleanup();
	});

	it("captures stdout, stderr, and combined output", () => {
		const manager = new ProcessManager();
		const proc = manager.start("build", "echo hi", "/repo");
		children[0]!.stdout.write("one\n");
		children[0]!.stdout.write("two\n");
		children[0]!.stderr.write("warn\n");

		const output = manager.getOutput(proc.id, 10);
		expect(output?.stdout).toEqual(["one", "two"]);
		expect(output?.stderr).toEqual(["warn"]);

		const combined = manager.getCombinedOutput(proc.id, 10);
		expect(combined).toEqual([
			{ type: "stdout", text: "one" },
			{ type: "stdout", text: "two" },
			{ type: "stderr", text: "warn" },
		]);
		manager.cleanup();
	});

	it("handles normal close and emits status events", () => {
		const manager = new ProcessManager();
		const events: string[] = [];
		manager.onEvent((event) => {
			events.push(event.type);
		});

		const proc = manager.start("build", "echo hi", "/repo");
		children[0]!.emit("close", 0);

		expect(manager.get(proc.id)?.status).toBe("exited");
		expect(manager.get(proc.id)?.success).toBe(true);
		expect(manager.get(proc.id)?.exitCode).toBe(0);
		expect(events).toContain("process_status_changed");
		expect(events).toContain("process_ended");
		manager.cleanup();
	});

	it("handles signal close as killed", () => {
		const manager = new ProcessManager();
		const proc = manager.start("build", "echo hi", "/repo");
		children[0]!.emit("close", 130, "SIGINT");

		expect(manager.get(proc.id)?.status).toBe("killed");
		expect(manager.get(proc.id)?.success).toBe(false);
		expect(manager.get(proc.id)?.exitCode).toBe(130);
		manager.cleanup();
	});

	it("handles child error as exit", () => {
		const manager = new ProcessManager();
		const proc = manager.start("build", "echo hi", "/repo");
		children[0]!.emit("error", new Error("boom"));

		expect(manager.get(proc.id)?.status).toBe("exited");
		expect(manager.get(proc.id)?.success).toBe(false);
		expect(manager.get(proc.id)?.exitCode).toBe(-1);
		manager.cleanup();
	});

	it("finds processes by id, name, and command", () => {
		const manager = new ProcessManager();
		const proc = manager.start("Builder", "echo task", "/repo");
		expect(manager.find(proc.id)?.id).toBe(proc.id);
		expect(manager.find("builder")?.id).toBe(proc.id);
		expect(manager.find("echo task")?.id).toBe(proc.id);
		manager.cleanup();
	});

	it("returns missing data for unknown ids", () => {
		const manager = new ProcessManager();
		expect(manager.get("missing")).toBeNull();
		expect(manager.getOutput("missing")).toBeNull();
		expect(manager.getCombinedOutput("missing")).toBeNull();
		expect(manager.getLogFiles("missing")).toBeNull();
		expect(manager.getFullOutput("missing")).toBeNull();
		manager.cleanup();
	});

	it("returns unknown for unknown kill target", async () => {
		const manager = new ProcessManager();
		const result = await manager.kill("does-not-exist");
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("not_found");
		manager.cleanup();
	});

	it("kills when group disappears", async () => {
		const manager = new ProcessManager();
		const proc = manager.start("build", "sleep 10", "/repo");
		spyIsAlive.mockReturnValue(false);
		const result = await manager.kill(proc.id, { timeoutMs: 1, signal: "SIGTERM" });
		expect(result.ok).toBe(true);
		expect(manager.get(proc.id)?.status).toBe("killed");
		manager.cleanup();
	});

	it("returns timeout when process stays alive", async () => {
		const manager = new ProcessManager();
		const proc = manager.start("build", "sleep 10", "/repo");
		spyIsAlive.mockReturnValue(true);
		const result = await manager.kill(proc.id, { timeoutMs: 1, signal: "SIGTERM" });
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("timeout");
		expect(manager.get(proc.id)?.status).toBe("terminate_timeout");
		manager.cleanup();
	});

	it("returns error when killProcessGroup throws non-EPERM", async () => {
		const manager = new ProcessManager();
		const proc = manager.start("build", "sleep 10", "/repo");
		spyKillGroup.mockImplementation(() => {
			const err = new Error("nope") as NodeJS.ErrnoException;
			err.code = "EACCES";
			throw err;
		});
		const result = await manager.kill(proc.id, { timeoutMs: 1, signal: "SIGTERM" });
		expect(result.ok).toBe(false);
		expect(result.reason).toBe("error");
		expect(manager.get(proc.id)?.status).toBe("terminating");
		manager.cleanup();
	});

	it("clears finished processes and keeps running ones", async () => {
		const manager = new ProcessManager();
		manager.start("first", "echo a", "/repo");
		manager.start("second", "echo b", "/repo");

		expect(children).toHaveLength(2);
		children[0]!.emit("close", 0);

		const cleared = manager.clearFinished();
		expect(cleared).toBe(1);
		const after = manager.list();
		expect(after).toHaveLength(1);
		expect(after[0].name).toBe("second");
		manager.cleanup();
	});

	it("returns processes in reverse order", () => {
		const manager = new ProcessManager();
		const first = manager.start("first", "echo a", "/repo");
		const second = manager.start("second", "echo b", "/repo");
		expect(manager.list().map((proc) => proc.id)).toEqual([second.id, first.id]);
		manager.cleanup();
	});

	it("gets file sizes, fallback 0 on missing files", () => {
		const manager = new ProcessManager();
		const proc = manager.start("build", "echo hi", "/repo");
		expect(manager.getFileSize(proc.id)).toEqual({ stdout: 0, stderr: 0 });
		manager.cleanup();
	});

	it("shutdownKillAll calls killProcessGroup", () => {
		const manager = new ProcessManager();
		manager.start("a", "echo a", "/repo");
		manager.start("b", "echo b", "/repo");

		spyKillGroup.mockClear();
		manager.shutdownKillAll();
		expect(spyKillGroup).toHaveBeenCalledTimes(2);
		manager.cleanup();
	});
});
