export type ErrorCode =
	| "GIT_TOO_OLD"
	| "NOT_A_GIT_REPO"
	| "GIT_COMMAND_FAILED"
	| "BRANCH_NOT_FOUND"
	| "WORKTREE_EXISTS"
	| "WORKTREE_NOT_FOUND"
	| "DIRTY_WORKTREE"
	| "REBASE_CONFLICT"
	| "DEP_INSTALL_FAILED"
	| "REMOVE_FAILED"
	| "INVALID_ARGUMENT";

export interface ToolError {
	ok: false;
	error: string;
	code: ErrorCode;
}

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
}

export type PackageManager = "pnpm" | "npm" | "yarn" | "bun" | "uv" | "pip";

export interface PackageManagerMatch {
	manager: PackageManager;
	lockfile: string;
	installCommand: string[];
}

export interface WorktreeInfo {
	path: string;
	branch: string | undefined;
	isMainWorktree: boolean;
	dirty: boolean;
	unpushedCount: number;
}

export interface CreateResult {
	ok: true;
	path: string;
	branch: string;
	created: boolean;
	packageManager: PackageManager | undefined;
	configFilesCopied: string[];
	gitignoreModified: boolean;
	direnvAllowRan: boolean;
	direnvAllowSuccess: boolean;
	direnvAllowError?: string;
}

export interface RemoveResult {
	ok: true;
	path: string;
	branch: string;
	branchDeleted: boolean;
	warnings: string[];
}

export interface SyncWorktreeResult {
	branch: string;
	path: string;
	ok: boolean;
	error?: string;
	conflicts?: string[];
	depsReinstalled: boolean;
}
