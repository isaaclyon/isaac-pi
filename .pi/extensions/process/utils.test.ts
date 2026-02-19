import { beforeEach, describe, expect, it, vi } from "vitest";

import { formatRuntime, formatStatus, truncateCmd } from "./utils/format.js";
import { hasAnsi, stripAnsi } from "./utils/ansi.js";
import { isProcessGroupAlive, killProcessGroup } from "./utils/process-group.js";


describe("process ansi utilities", () => {
	it("detects ANSI sequences and strips CSI / OSC / APC", () => {
		expect(hasAnsi("hello")).toBe(false);
		expect(hasAnsi("\u001b[31mred\u001b[0m")).toBe(true);

		expect(stripAnsi("\u001b[31mred\u001b[0m")).toBe("red");
		expect(stripAnsi("plain text")).toBe("plain text");

		const osc = "\u001b]8;;https://example.com\u0007link\u001b]8;;\u0007";
		expect(stripAnsi(osc)).toBe("link");

		const apc = "prefix\u001b_foo\u001b\\suffix";
		expect(stripAnsi(apc)).toBe("prefixsuffix");
	});
});

describe("process runtime and status formatting", () => {
	it("formats runtime using seconds/minutes/hours", () => {
		expect(formatRuntime(0, 12_300)).toBe("12s");
		expect(formatRuntime(0, 65_000)).toBe("1m 5s");
		expect(formatRuntime(0, 3_610_000)).toBe("1h 0m");
	});

	it("formats status values", () => {
		expect(formatStatus({ status: "running" } as never)).toBe("running");
		expect(formatStatus({ status: "terminating" } as never)).toBe("terminating");
		expect(formatStatus({ status: "terminate_timeout" } as never)).toBe("terminate_timeout");
		expect(formatStatus({ status: "killed" } as never)).toBe("killed");
		expect(formatStatus({ status: "exited", success: true, exitCode: 0 } as never)).toBe("exit(0)");
		expect(formatStatus({ status: "exited", success: false, exitCode: 13 } as never)).toBe("exit(13)");
		expect(formatStatus({ status: "exited", success: false, exitCode: null } as never)).toBe("exit(?)");
	});

	it("truncates long commands and keeps short commands", () => {
		expect(truncateCmd("short", 10)).toBe("short");
		expect(truncateCmd("this is a very long command", 10)).toBe("this is...");
	});
});

describe("process group helpers", () => {
	const originalKill = process.kill;

	beforeEach(() => {
		process.kill = originalKill;
	});

	it("reports alive when process.kill with signal 0 succeeds", () => {
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
			return true as never;
		});
		expect(isProcessGroupAlive(999)).toBe(true);
		expect(killSpy).toHaveBeenCalledWith(-999, 0);
	});

	it("reports alive on EPERM", () => {
		vi.spyOn(process, "kill").mockImplementation(() => {
			const err = new Error("eperm") as NodeJS.ErrnoException;
			err.code = "EPERM";
			throw err;
		});
		expect(isProcessGroupAlive(888)).toBe(true);
	});

	it("sends kill signal to process group", () => {
		const killSpy = vi.spyOn(process, "kill").mockImplementation(() => {
			return true as never;
		});
		killProcessGroup(777, "SIGKILL");
		expect(killSpy).toHaveBeenCalledWith(-777, "SIGKILL");
	});
});
