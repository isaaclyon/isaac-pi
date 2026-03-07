import { beforeEach, describe, expect, it, vi } from "vitest";

import { copyAllConfigFiles, copyConfigFiles, copyEnvFiles, ensureGitignoreEntry, findGitignoredFiles } from "./config.js";

const mockReadFile = vi.fn();
const mockWriteFile = vi.fn();
const mockCopyFile = vi.fn();
const mockAccess = vi.fn();
const mockReaddir = vi.fn();
const mockStat = vi.fn();
const mockMkdir = vi.fn();
const mockExecFile = vi.fn();

vi.mock("node:fs/promises", () => ({
	access: (...args: any[]) => mockAccess(...args),
	constants: { F_OK: 0 },
	copyFile: (...args: any[]) => mockCopyFile(...args),
	mkdir: (...args: any[]) => mockMkdir(...args),
	readFile: (...args: any[]) => mockReadFile(...args),
	writeFile: (...args: any[]) => mockWriteFile(...args),
	readdir: (...args: any[]) => mockReaddir(...args),
	stat: (...args: any[]) => mockStat(...args),
}));

vi.mock("node:child_process", () => ({
	execFile: (...args: any[]) => mockExecFile(...args),
}));

describe("worktree config file helpers", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("adds .worktrees/ entry when missing", async () => {
		mockReadFile.mockResolvedValue("node_modules\n");
		const writeSpy = mockWriteFile.mockResolvedValue(undefined);

		const modified = await ensureGitignoreEntry("/tmp/repo");
		expect(modified).toBe(true);
		expect(writeSpy).toHaveBeenCalledWith("/tmp/repo/.gitignore", "node_modules\n.worktrees/\n", "utf-8");
	});

	it("does not duplicate existing .worktrees entry", async () => {
		mockReadFile.mockResolvedValue(".worktrees\n");
		expect(await ensureGitignoreEntry("/tmp/repo")).toBe(false);
		expect(mockWriteFile).not.toHaveBeenCalled();
	});

	it("copies only existing .env files", async () => {
		mockReaddir.mockResolvedValue([".env", "other.txt", ".env.local"]);
		mockStat.mockImplementation(async (p: string) => ({ isFile: () => p.endsWith(".env") || p.endsWith(".env.local") }));
		mockCopyFile.mockResolvedValue(undefined);

		expect(await copyEnvFiles("/tmp/repo", "/tmp/worktree")).toEqual([".env", ".env.local"]);
		expect(mockCopyFile).toHaveBeenCalledWith("/tmp/repo/.env", "/tmp/worktree/.env");
		expect(mockCopyFile).toHaveBeenCalledWith("/tmp/repo/.env.local", "/tmp/worktree/.env.local");
	});

	it("copies repo-relative paths and blocks paths outside repo", async () => {
		mockAccess.mockResolvedValue(undefined);
		mockStat.mockImplementation(async (p: string) => ({ isFile: () => !p.endsWith("dir") }));
		mockCopyFile.mockResolvedValue(undefined);
		mockMkdir.mockResolvedValue(undefined);

		expect(
			await copyConfigFiles("/tmp/repo", "/tmp/worktree", [
				"readme.md",
				"../outside.md",
				"/tmp/repo/.env.local",
				"/tmp/repo2/secret.md",
			]),
		).toEqual(["readme.md", ".env.local"]);
		expect(mockCopyFile).toHaveBeenCalledWith("/tmp/repo/.env.local", "/tmp/worktree/.env.local");
	});

	it("reads gitignored root files and filters entries", async () => {
		mockExecFile.mockImplementation((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, ".foo\n.env\ncache.db\nbar/.gitignore\n", "");
			return { on: vi.fn() };
		});

		expect(await findGitignoredFiles("/tmp/repo")).toEqual([".foo"]);
	});

	it("copies env, ignored, and extra files with dedupe", async () => {
		mockReaddir.mockResolvedValue([".env", ".env.test", "other"]);
		mockStat.mockImplementation(async (p: string) => ({ isFile: () => !p.endsWith("other") }));
		mockCopyFile.mockResolvedValue(undefined);
		mockAccess.mockResolvedValue(undefined);
		mockExecFile.mockImplementation((...args: any[]) => {
			const cb: any = args.at(-1);
			cb?.(null, ".foo\nother\n", "");
			return { on: vi.fn() };
		});
		mockMkdir.mockResolvedValue(undefined);

		expect(await copyAllConfigFiles("/tmp/repo", "/tmp/worktree", [".env.test"])).toEqual([".env", ".env.test", ".foo"]); // order is stable
	});
});
