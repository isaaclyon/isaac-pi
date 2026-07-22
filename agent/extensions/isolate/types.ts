export type IsolationPhase =
	| "creating"
	| "active"
	| "finish_requested"
	| "integrating"
	| "conflicted"
	| "ff_pending"
	| "integrated"
	| "cleanup_pending"
	| "discarding"
	| "done";

export interface RepositoryInfo {
	root: string;
	commonDir: string;
	branch: string;
	head: string;
}

export interface IsolationState {
	version: 1;
	id: string;
	phase: IsolationPhase;
	exitMode?: "finish" | "discard";
	task: string;
	createdAt: string;
	repositoryRoot: string;
	gitCommonDir: string;
	baseBranch: string;
	baseHead: string;
	sourceCwd: string;
	sourceSessionFile: string;
	worktreePath: string;
	worktreeCwd: string;
	worktreeBranch: string;
	worktreeGitDir?: string;
	isolatedSessionFile?: string;
	driverToken?: string;
	cleanupBranchHead?: string;
	rebasedHead?: string;
	expectedParentHead?: string;
	integratedHead?: string;
	lastError?: string;
}

export interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

export type CommandRunner = (
	command: string,
	args: string[],
	cwd: string,
	options?: { signal?: AbortSignal; timeout?: number },
) => Promise<CommandResult>;
