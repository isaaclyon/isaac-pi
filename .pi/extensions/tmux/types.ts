export type ErrorCode =
	| "TMUX_NOT_FOUND"
	| "INVALID_ARGUMENT"
	| "SESSION_NOT_FOUND"
	| "WINDOW_NOT_FOUND"
	| "TIMEOUT"
	| "TMUX_COMMAND_FAILED";

export interface ToolError {
	ok: false;
	error: string;
	code: ErrorCode;
}

export interface TmuxExecResult {
	ok: boolean;
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
	errorCode?: ErrorCode;
}

export interface SessionInfo {
	name: string;
	createdEpochSec?: number;
	attached?: boolean;
}

export interface WindowInfo {
	index: number;
	name: string;
	active: boolean;
}

export interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details: Record<string, unknown>;
	isError?: boolean;
}

export type ServeStatus = "starting" | "running" | "ready" | "crashed" | "stopped";

export interface ServeMonitorInfo {
	monitorId: string;
	sessionName: string;
	windowName: string;
	command: string;
	socketPath?: string;
	status: ServeStatus;
	processName?: string;
	startedAtEpoch: number;
	readyAtEpoch?: number;
	crashedAtEpoch?: number;
	stoppedAtEpoch?: number;
}
