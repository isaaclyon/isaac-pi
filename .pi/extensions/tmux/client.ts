import { spawn } from "node:child_process";
import type { SessionInfo, ToolError, TmuxExecResult, WindowInfo } from "./types";
import { makeToolError } from "./results";

function withSocket(socketPath: string | undefined, args: string[]): string[] {
	if (!socketPath) return args;
	return ["-S", socketPath, ...args];
}

export async function runTmux(args: string[], options?: { socketPath?: string; timeoutSec?: number }): Promise<TmuxExecResult> {
	const timeoutSec = Math.max(1, Math.floor(options?.timeoutSec ?? 15));
	const tmuxArgs = withSocket(options?.socketPath, args);

	return new Promise((resolve) => {
		const child = spawn("tmux", tmuxArgs, { stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		let timedOut = false;

		const timeout = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
		}, timeoutSec * 1000);

		child.stdout.on("data", (chunk: Buffer) => {
			stdout += chunk.toString("utf8");
		});
		child.stderr.on("data", (chunk: Buffer) => {
			stderr += chunk.toString("utf8");
		});

		child.on("error", (error: NodeJS.ErrnoException) => {
			clearTimeout(timeout);
			if (error.code === "ENOENT") {
				resolve({ ok: false, stdout, stderr, exitCode: 127, timedOut: false, errorCode: "TMUX_NOT_FOUND" });
				return;
			}
			resolve({ ok: false, stdout, stderr: error.message || stderr, exitCode: 1, timedOut: false, errorCode: "TMUX_COMMAND_FAILED" });
		});

		child.on("close", (code) => {
			clearTimeout(timeout);
			if (timedOut) {
				resolve({ ok: false, stdout, stderr, exitCode: code ?? 124, timedOut: true, errorCode: "TIMEOUT" });
				return;
			}
			resolve({ ok: (code ?? 1) === 0, stdout, stderr, exitCode: code ?? 1, timedOut: false });
		});
	});
}

export async function tmuxAvailable(socketPath?: string): Promise<true | ToolError> {
	const check = await runTmux(["-V"], { socketPath, timeoutSec: 5 });
	if (check.ok) return true;
	if (check.errorCode === "TMUX_NOT_FOUND") {
		return makeToolError("tmux is not installed or not available in PATH", "TMUX_NOT_FOUND");
	}
	if (check.errorCode === "TIMEOUT") {
		return makeToolError("tmux version check timed out", "TIMEOUT");
	}
	return makeToolError(`tmux check failed: ${check.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED");
}

export async function hasSession(sessionName: string, socketPath?: string): Promise<boolean> {
	const result = await runTmux(["has-session", "-t", sessionName], { socketPath, timeoutSec: 8 });
	return result.ok;
}

export async function listSessions(socketPath?: string): Promise<SessionInfo[] | ToolError> {
	const result = await runTmux(["list-sessions", "-F", "#{session_name}\t#{session_created}\t#{session_attached}"], {
		socketPath,
		timeoutSec: 10,
	});

	if (!result.ok) {
		const lowered = result.stderr.toLowerCase();
		if (lowered.includes("no server running") || lowered.includes("no sessions")) {
			return [];
		}
		if (result.errorCode === "TMUX_NOT_FOUND") return makeToolError("tmux is not installed or not available in PATH", "TMUX_NOT_FOUND");
		if (result.errorCode === "TIMEOUT") return makeToolError("tmux list-sessions timed out", "TIMEOUT");
		return makeToolError(`tmux list-sessions failed: ${result.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED");
	}

	const sessions: SessionInfo[] = [];
	for (const rawLine of result.stdout.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;
		const [name, created, attached] = line.split("\t");
		if (!name) continue;
		sessions.push({
			name,
			createdEpochSec: created ? Number.parseInt(created, 10) : undefined,
			attached: attached ? Number.parseInt(attached, 10) > 0 : undefined,
		});
	}
	return sessions;
}

export async function listWindows(sessionName: string, socketPath?: string): Promise<WindowInfo[] | ToolError> {
	const result = await runTmux(["list-windows", "-t", sessionName, "-F", "#{window_index}\t#{window_name}\t#{window_active}"], {
		socketPath,
		timeoutSec: 10,
	});
	if (!result.ok) {
		const lowered = result.stderr.toLowerCase();
		if (lowered.includes("can't find session")) return makeToolError(`Session not found: ${sessionName}`, "SESSION_NOT_FOUND");
		return makeToolError(`tmux list-windows failed: ${result.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED");
	}

	return result.stdout
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
		.map((line) => {
			const [index, name, active] = line.split("\t");
			return {
				index: Number.parseInt(index || "0", 10),
				name: name || "",
				active: active === "1",
			};
		});
}
