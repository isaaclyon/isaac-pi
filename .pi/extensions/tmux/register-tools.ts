import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { randomBytes } from "node:crypto";
import {
	DEFAULT_CAPTURE_LINES,
	DEFAULT_CAPTURE_TIMEOUT_SEC,
	DEFAULT_RUN_TIMEOUT_SEC,
	DEFAULT_STALE_TTL_SEC,
	DEFAULT_WINDOW,
	escapeRegExp,
	isManagedSession,
	nowEpochSec,
	sleep,
	stripAnsi,
} from "./constants";
import { hasSession, listSessions, listWindows, runTmux, tmuxAvailable } from "./client";
import { resolveManagedSessionName, validateManagedSessionName, validateWindowName } from "./naming";
import { buildToolResult, isToolError, makeToolError } from "./results";
import type { WindowInfo } from "./types";

function validateDoneMarker(marker: string): boolean {
	return /^[A-Za-z0-9_-]{1,64}$/.test(marker);
}

export function registerTmuxTools(pi: ExtensionAPI): void {
	const EnsureSessionParams = Type.Object({
		sessionName: Type.Optional(Type.String({ description: "Optional managed session name (must start with pi-)" })),
		taskSlug: Type.Optional(Type.String({ description: "Used when generating a name (default: task)" })),
		cwd: Type.Optional(Type.String({ description: "Working directory for new session (default: current directory)" })),
		socketPath: Type.Optional(Type.String({ description: "Optional tmux socket path (-S)" })),
	});

	pi.registerTool({
		name: "tmux_ensure_session",
		label: "tmux ensure session",
		description: "Create or reuse a managed tmux session (pi-*).",
		parameters: EnsureSessionParams,
		async execute(_id, params) {
			const available = await tmuxAvailable(params.socketPath);
			if (available !== true) return buildToolResult(available);

			const sessionName = resolveManagedSessionName(params.sessionName, params.taskSlug);
			const nameError = validateManagedSessionName(sessionName);
			if (nameError) return buildToolResult(nameError);

			const cwd = (params.cwd || process.cwd()).trim();
			const exists = await hasSession(sessionName, params.socketPath);
			if (!exists) {
				const create = await runTmux(["new-session", "-d", "-s", sessionName, "-c", cwd], { socketPath: params.socketPath, timeoutSec: 15 });
				if (!create.ok) {
					const err = create.errorCode === "TIMEOUT" ? makeToolError("tmux new-session timed out", "TIMEOUT") : makeToolError(`Failed to create session: ${create.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED");
					return buildToolResult(err);
				}
			}

			const sessions = await listSessions(params.socketPath);
			if (isToolError(sessions)) return buildToolResult(sessions);
			const info = sessions.find((s) => s.name === sessionName);
			return buildToolResult({
				ok: true,
				sessionName,
				managed: true,
				created: !exists,
				createdAtEpoch: info?.createdEpochSec ?? nowEpochSec(),
				cwd,
				socketPath: params.socketPath,
				command: `tmux ${params.socketPath ? `-S ${params.socketPath} ` : ""}new-session -d -s ${sessionName} -c ${cwd}`,
			});
		},
	});

	const RunParams = Type.Object({
		sessionName: Type.String({ description: "Managed tmux session name (pi-*)" }),
		command: Type.String({ description: "Shell command to run in target window" }),
		windowName: Type.Optional(Type.String({ description: "Target window name (default: main)" })),
		cwd: Type.Optional(Type.String({ description: "Working directory for created window" })),
		socketPath: Type.Optional(Type.String({ description: "Optional tmux socket path (-S)" })),
		createWindowIfMissing: Type.Optional(Type.Boolean({ description: "Create target window when missing (default: true)" })),
		waitForExit: Type.Optional(Type.Boolean({ description: "Wait for done marker + exit code (default: false)" })),
		timeoutSec: Type.Optional(Type.Number({ description: "Wait timeout in seconds (default: 600)", minimum: 1, maximum: 86_400 })),
		doneMarker: Type.Optional(Type.String({ description: "Optional completion marker. Auto-generated in wait mode if omitted." })),
	});

	pi.registerTool({
		name: "tmux_run",
		label: "tmux run",
		description: "Run a command in a managed tmux session/window.",
		parameters: RunParams,
		async execute(_id, params) {
			const available = await tmuxAvailable(params.socketPath);
			if (available !== true) return buildToolResult(available);

			const nameError = validateManagedSessionName(params.sessionName);
			if (nameError) return buildToolResult(nameError);
			if (!params.command.trim()) return buildToolResult(makeToolError("command is required", "INVALID_ARGUMENT"));

			const sessionExists = await hasSession(params.sessionName, params.socketPath);
			if (!sessionExists) return buildToolResult(makeToolError(`Session not found: ${params.sessionName}`, "SESSION_NOT_FOUND"));

			const windowName = (params.windowName || DEFAULT_WINDOW).trim();
			const windowError = validateWindowName(windowName);
			if (windowError) return buildToolResult(windowError);

			const createWindow = params.createWindowIfMissing !== false;
			const windows = await listWindows(params.sessionName, params.socketPath);
			if (isToolError(windows)) return buildToolResult(windows);
			const existing = windows.some((w) => w.name === windowName);
			if (!existing && !createWindow) return buildToolResult(makeToolError(`Window not found: ${windowName}`, "WINDOW_NOT_FOUND"));
			if (!existing && createWindow) {
				const newWindow = await runTmux(["new-window", "-d", "-t", params.sessionName, "-n", windowName, "-c", params.cwd || process.cwd()], {
					socketPath: params.socketPath,
					timeoutSec: 12,
				});
				if (!newWindow.ok) return buildToolResult(makeToolError(`Failed to create window: ${newWindow.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED"));
			}

			const waitForExit = params.waitForExit === true;
			const marker = params.doneMarker?.trim() || `__PI_DONE__${randomBytes(6).toString("hex")}`;
			if (waitForExit && !validateDoneMarker(marker)) {
				return buildToolResult(makeToolError("doneMarker must match ^[A-Za-z0-9_-]{1,64}$", "INVALID_ARGUMENT"));
			}
			const runCommand = waitForExit
				? `${params.command}; __PI_EXIT_CODE=$?; printf '${marker}:%s\\n' "$__PI_EXIT_CODE"`
				: params.command;
			const target = `${params.sessionName}:${windowName}`;
			const send = await runTmux(["send-keys", "-t", target, runCommand, "C-m"], { socketPath: params.socketPath, timeoutSec: 10 });
			if (!send.ok) return buildToolResult(makeToolError(`Failed to send command: ${send.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED"));

			const startedAtEpoch = nowEpochSec();
			if (!waitForExit) {
				return buildToolResult({
					ok: true,
					sessionName: params.sessionName,
					windowName,
					socketPath: params.socketPath,
					started: true,
					startedAtEpoch,
					command: params.command,
				});
			}

			const timeoutSec = Math.floor(params.timeoutSec ?? DEFAULT_RUN_TIMEOUT_SEC);
			const deadline = Date.now() + timeoutSec * 1000;
			const markerRegex = new RegExp(`${escapeRegExp(marker)}:(-?\\d+)`);
			while (Date.now() < deadline) {
				const capture = await runTmux(["capture-pane", "-p", "-t", target, "-S", "-500"], { socketPath: params.socketPath, timeoutSec: 10 });
				if (capture.ok) {
					const match = capture.stdout.match(markerRegex);
					if (match?.[1]) {
						return buildToolResult({
							ok: true,
							sessionName: params.sessionName,
							windowName,
							socketPath: params.socketPath,
							started: true,
							startedAtEpoch,
							command: params.command,
							completed: true,
							completedAtEpoch: nowEpochSec(),
							marker,
							exitCode: Number.parseInt(match[1], 10),
							timeout: false,
						});
					}
				}
				await sleep(800);
			}

			return buildToolResult({
				ok: false,
				sessionName: params.sessionName,
				windowName,
				socketPath: params.socketPath,
				started: true,
				startedAtEpoch,
				command: params.command,
				completed: false,
				marker,
				timeout: true,
				error: `Timed out waiting for completion marker after ${timeoutSec}s`,
				code: "TIMEOUT",
			});
		},
	});

	const CaptureParams = Type.Object({
		sessionName: Type.String({ description: "Managed tmux session name (pi-*)" }),
		windowName: Type.Optional(Type.String({ description: "Window name (default: main)" })),
		lines: Type.Optional(Type.Number({ description: "Number of lines to capture (default: 200)", minimum: 1, maximum: 5000 })),
		socketPath: Type.Optional(Type.String({ description: "Optional tmux socket path (-S)" })),
		stripAnsi: Type.Optional(Type.Boolean({ description: "Strip ANSI escape codes from output (default: true)" })),
		captureTimeoutSec: Type.Optional(Type.Number({ description: "Capture timeout in seconds (default: 30)", minimum: 1, maximum: 300 })),
	});

	pi.registerTool({
		name: "tmux_capture",
		label: "tmux capture",
		description: "Capture recent output from a managed tmux session/window.",
		parameters: CaptureParams,
		async execute(_id, params) {
			const available = await tmuxAvailable(params.socketPath);
			if (available !== true) return buildToolResult(available);
			const nameError = validateManagedSessionName(params.sessionName);
			if (nameError) return buildToolResult(nameError);

			const windowName = (params.windowName || DEFAULT_WINDOW).trim();
			const lines = Math.floor(params.lines ?? DEFAULT_CAPTURE_LINES);
			const captureTimeoutSec = Math.floor(params.captureTimeoutSec ?? DEFAULT_CAPTURE_TIMEOUT_SEC);
			const target = `${params.sessionName}:${windowName}`;
			const captured = await runTmux(["capture-pane", "-p", "-t", target, "-S", `-${lines}`], {
				socketPath: params.socketPath,
				timeoutSec: captureTimeoutSec,
			});

			if (!captured.ok) {
				if (captured.errorCode === "TIMEOUT") return buildToolResult(makeToolError("tmux capture timed out", "TIMEOUT"));
				const lowered = captured.stderr.toLowerCase();
				if (lowered.includes("can't find pane") || lowered.includes("can't find window")) {
					return buildToolResult(makeToolError(`Window not found: ${windowName}`, "WINDOW_NOT_FOUND"));
				}
				if (lowered.includes("can't find session")) return buildToolResult(makeToolError(`Session not found: ${params.sessionName}`, "SESSION_NOT_FOUND"));
				return buildToolResult(makeToolError(`tmux capture failed: ${captured.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED"));
			}

			const content = params.stripAnsi !== false ? stripAnsi(captured.stdout) : captured.stdout;
			return buildToolResult({ ok: true, sessionName: params.sessionName, windowName, socketPath: params.socketPath, lines, content });
		},
	});

	const ListParams = Type.Object({
		socketPath: Type.Optional(Type.String({ description: "Optional tmux socket path (-S)" })),
		includeWindows: Type.Optional(Type.Boolean({ description: "Include windows for each managed session (default: false)" })),
	});

	pi.registerTool({
		name: "tmux_list",
		label: "tmux list",
		description: "List managed tmux sessions (pi-*).",
		parameters: ListParams,
		async execute(_id, params) {
			const available = await tmuxAvailable(params.socketPath);
			if (available !== true) return buildToolResult(available);

			const sessions = await listSessions(params.socketPath);
			if (isToolError(sessions)) return buildToolResult(sessions);
			const managed = sessions.filter((s) => isManagedSession(s.name));

			const includeWindows = params.includeWindows === true;
			const detailed: Array<{ name: string; managed: true; createdEpochSec?: number; attached?: boolean; windows?: WindowInfo[] }> = [];
			for (const session of managed) {
				const entry: { name: string; managed: true; createdEpochSec?: number; attached?: boolean; windows?: WindowInfo[] } = {
					name: session.name,
					managed: true,
					createdEpochSec: session.createdEpochSec,
					attached: session.attached,
				};
				if (includeWindows) {
					const windows = await listWindows(session.name, params.socketPath);
					if (!isToolError(windows)) entry.windows = windows;
				}
				detailed.push(entry);
			}

			return buildToolResult({ ok: true, socketPath: params.socketPath, sessions: detailed });
		},
	});

	const CleanupParams = Type.Object({
		mode: StringEnum(["single", "stale"] as const, { description: "single = one session, stale = all managed sessions older than TTL" }),
		sessionName: Type.Optional(Type.String({ description: "Required when mode is single" })),
		staleTtlSec: Type.Optional(Type.Number({ description: "Stale threshold in seconds (default: 86400)", minimum: 1, maximum: 31_536_000 })),
		socketPath: Type.Optional(Type.String({ description: "Optional tmux socket path (-S)" })),
		dryRun: Type.Optional(Type.Boolean({ description: "Show what would be cleaned without killing (default: true)" })),
	});

	pi.registerTool({
		name: "tmux_cleanup",
		label: "tmux cleanup",
		description: "Clean up managed tmux sessions safely.",
		parameters: CleanupParams,
		async execute(_id, params) {
			const available = await tmuxAvailable(params.socketPath);
			if (available !== true) return buildToolResult(available);

			const dryRun = params.dryRun !== false;
			if (params.mode === "single") {
				if (!params.sessionName?.trim()) return buildToolResult(makeToolError("sessionName is required for mode=single", "INVALID_ARGUMENT"));
				const sessionName = params.sessionName.trim();
				const nameError = validateManagedSessionName(sessionName);
				if (nameError) return buildToolResult(nameError);
				const exists = await hasSession(sessionName, params.socketPath);
				if (!exists) return buildToolResult(makeToolError(`Session not found: ${sessionName}`, "SESSION_NOT_FOUND"));

				if (!dryRun) {
					const kill = await runTmux(["kill-session", "-t", sessionName], { socketPath: params.socketPath, timeoutSec: 10 });
					if (!kill.ok) return buildToolResult(makeToolError(`Failed to kill session: ${kill.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED"));
				}
				return buildToolResult({ ok: true, mode: "single", socketPath: params.socketPath, dryRun, checked: 1, matched: 1, killed: dryRun ? [] : [sessionName], skipped: dryRun ? [{ sessionName, reason: "dry-run" }] : [] });
			}

			const staleTtlSec = Math.floor(params.staleTtlSec ?? DEFAULT_STALE_TTL_SEC);
			const sessions = await listSessions(params.socketPath);
			if (isToolError(sessions)) return buildToolResult(sessions);

			const managed = sessions.filter((s) => isManagedSession(s.name));
			const now = nowEpochSec();
			const killed: string[] = [];
			const skipped: Array<{ sessionName: string; reason: string }> = [];
			let matched = 0;

			for (const session of managed) {
				if (!session.createdEpochSec) {
					skipped.push({ sessionName: session.name, reason: "missing-session-created" });
					continue;
				}
				if (now - session.createdEpochSec < staleTtlSec) {
					skipped.push({ sessionName: session.name, reason: "not-stale" });
					continue;
				}
				matched += 1;
				if (dryRun) {
					skipped.push({ sessionName: session.name, reason: "dry-run" });
					continue;
				}
				const kill = await runTmux(["kill-session", "-t", session.name], { socketPath: params.socketPath, timeoutSec: 10 });
				if (kill.ok) killed.push(session.name);
				else skipped.push({ sessionName: session.name, reason: kill.stderr || "kill-failed" });
			}

			return buildToolResult({ ok: true, mode: "stale", socketPath: params.socketPath, dryRun, checked: managed.length, matched, killed, skipped });
		},
	});
}
