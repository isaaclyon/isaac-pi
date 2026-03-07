import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { detectPackageManager, installDeps } from "./deps.js";
import type { PackageManagerMatch } from "./types.js";

const mockAccess = vi.fn();
const mockExecFile = vi.fn();

vi.mock("node:fs/promises", () => ({
	access: (...args: any[]) => mockAccess(...args),
	constants: { F_OK: 0 },
}));

vi.mock("node:child_process", () => ({
	execFile: (...args: any[]) => mockExecFile(...args),
}));

describe("worktree dependency helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("detects package manager by lockfile priority", async () => {
		mockAccess.mockImplementation(async (filePath: string) => {
			if (String(filePath).endsWith("pnpm-lock.yaml")) return;
			const err = new Error("missing") as NodeJS.ErrnoException;
			err.code = "ENOENT";
			throw err;
		});

		const detected = await detectPackageManager("/tmp/repo");
		expect(detected?.manager).toBe("pnpm");
		expect(detected?.lockfile).toBe("pnpm-lock.yaml");
		expect(detected?.installCommand).toEqual(["pnpm", "install", "--frozen-lockfile"]);
	});

	it("returns undefined when no manager found", async () => {
		mockAccess.mockRejectedValue(Object.assign(new Error("missing"), { code: "ENOENT" }));
		expect(await detectPackageManager("/tmp/repo")).toBeUndefined();
	});

	it("installs dependencies successfully", async () => {
		const execSpy = mockExecFile.mockImplementation((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, "", "");
			return { on: vi.fn() };
		});

		const pm: PackageManagerMatch = {
			manager: "pnpm",
			lockfile: "pnpm-lock.yaml",
			installCommand: ["pnpm", "install"],
		};
		const result = await installDeps("/tmp/worktree", pm);
		expect(execSpy).toHaveBeenCalledWith("pnpm", ["install"], expect.any(Object), expect.any(Function));
		expect(result).toBe(true);
	});

	it("reports install failure with stderr", async () => {
		mockExecFile.mockImplementation((...args: any[]) => {
			const cb: any = args.at(-1);
			const err = new Error("fail") as NodeJS.ErrnoException;
			err.code = "1";
			cb?.(err, "", "bad install");
			return { on: vi.fn() };
		});
		const pm: PackageManagerMatch = {
			manager: "npm",
			lockfile: "package-lock.json",
			installCommand: ["npm", "ci"],
		};
		const result = await installDeps("/tmp/worktree", pm);
		expect(result).toEqual({ ok: false, error: "npm install failed: bad install", code: "DEP_INSTALL_FAILED" });
	});

	it("reports missing manager executable", async () => {
		mockExecFile.mockImplementation((..._args: any[]) => {
			const child = {
				on: vi.fn((event: string, handler: (err: NodeJS.ErrnoException) => void) => {
					if (event === "error") {
						const errorObj: NodeJS.ErrnoException = new Error("not found") as NodeJS.ErrnoException;
						errorObj.code = "ENOENT";
						handler(errorObj);
					}
				}),
			};
			return child as never;
		});
		const pm: PackageManagerMatch = {
			manager: "bun",
			lockfile: "bun.lockb",
			installCommand: ["bun", "install"],
		};
		const result = await installDeps("/tmp/worktree", pm);
		expect(result).toEqual({ ok: false, error: "bun is not installed or not available in PATH", code: "DEP_INSTALL_FAILED" });
	});
});
