import { afterEach, describe, expect, it, vi } from "vitest";

import * as git from "./git.js";
import { worktreeList, formatWorktreeList } from "./list.js";

describe("worktree list", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("returns worktree list directly from git helpers", async () => {
		const info = [
			{ path: "/tmp/main", branch: "main", isMainWorktree: true, dirty: false, unpushedCount: 0 },
			{ path: "/tmp/feature", branch: "feat", isMainWorktree: false, dirty: true, unpushedCount: 2 },
		];
		vi.spyOn(git, "checkGitVersion").mockResolvedValue(true);
		vi.spyOn(git, "getRepoRoot").mockResolvedValue("/tmp/repo");
		vi.spyOn(git, "listWorktrees").mockResolvedValue(info);
		vi.spyOn(git, "isDirty").mockResolvedValue(false);
		vi.spyOn(git, "unpushedCount").mockResolvedValue(0);

		const result = await worktreeList();
		expect(result).toEqual(info);
	});

	it("returns tool error when git is unavailable", async () => {
		vi.spyOn(git, "checkGitVersion").mockResolvedValue({ ok: false, error: "bad", code: "GIT_TOO_OLD" });
		const result = await worktreeList();
		expect(result).toEqual({ ok: false, error: "bad", code: "GIT_TOO_OLD" });
	});

	it("formats lists for display", () => {
		const text = formatWorktreeList([
			{ path: "/tmp/main", branch: undefined, isMainWorktree: true, dirty: true, unpushedCount: 0 },
			{ path: "/tmp/f", branch: "f", isMainWorktree: false, dirty: false, unpushedCount: 2 },
		]);
		expect(text).toBe("(detached HEAD) (main): /tmp/main [dirty]\nf: /tmp/f [clean, 2 unpushed]");
	});

	it("formats empty list", () => {
		expect(formatWorktreeList([])).toBe("No worktrees found.");
	});
});
