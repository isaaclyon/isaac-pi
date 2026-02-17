import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { DEFAULT_WINDOW } from "./constants";
import { hasSession, listWindows, runTmux, tmuxAvailable } from "./client";
import { validateManagedSessionName, validateWindowName } from "./naming";
import { buildToolResult, isToolError, makeToolError } from "./results";
import type { ServeManager } from "./serve-manager";

export function registerServeTools(pi: ExtensionAPI, serveManager: ServeManager): void {
	const ServeParams = Type.Object({
		sessionName: Type.String({ description: "Managed tmux session name (pi-*)" }),
		command: Type.String({ description: "Long-running command to start (e.g., 'npm run dev')" }),
		windowName: Type.Optional(Type.String({ description: "Target window name (default: main)" })),
		cwd: Type.Optional(Type.String({ description: "Working directory for created window" })),
		socketPath: Type.Optional(Type.String({ description: "Optional tmux socket path (-S)" })),
		pollIntervalSec: Type.Optional(
			Type.Number({ description: "How often to check if the process is alive (default: 3)", minimum: 1, maximum: 60 }),
		),
		readyPattern: Type.Optional(
			Type.String({ description: "Regex pattern to detect when server is ready (e.g., 'listening on port')" }),
		),
	});

	pi.registerTool({
		name: "tmux_serve",
		label: "tmux serve",
		description:
			"Start a long-running process (dev server, watcher) in tmux with automatic crash detection. " +
			"Returns immediately. If the process crashes, the LLM is automatically alerted.",
		parameters: ServeParams,
		async execute(_id, params) {
			const available = await tmuxAvailable(params.socketPath);
			if (available !== true) return buildToolResult(available);

			const nameError = validateManagedSessionName(params.sessionName);
			if (nameError) return buildToolResult(nameError);
			if (!params.command.trim()) return buildToolResult(makeToolError("command is required", "INVALID_ARGUMENT"));

			const sessionExists = await hasSession(params.sessionName, params.socketPath);
			if (!sessionExists) {
				return buildToolResult(makeToolError(`Session not found: ${params.sessionName}`, "SESSION_NOT_FOUND"));
			}

			const windowName = (params.windowName || DEFAULT_WINDOW).trim();
			const windowError = validateWindowName(windowName);
			if (windowError) return buildToolResult(windowError);

			const windows = await listWindows(params.sessionName, params.socketPath);
			if (isToolError(windows)) return buildToolResult(windows);
			const existing = windows.some((w) => w.name === windowName);
			if (!existing) {
				const cwd = params.cwd || process.cwd();
				const newWindow = await runTmux(
					["new-window", "-d", "-t", params.sessionName, "-n", windowName, "-c", cwd],
					{ socketPath: params.socketPath, timeoutSec: 12 },
				);
				if (!newWindow.ok) {
					return buildToolResult(
						makeToolError(`Failed to create window: ${newWindow.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED"),
					);
				}
			}

			const target = `${params.sessionName}:${windowName}`;
			const send = await runTmux(["send-keys", "-t", target, params.command, "C-m"], {
				socketPath: params.socketPath,
				timeoutSec: 10,
			});
			if (!send.ok) {
				return buildToolResult(
					makeToolError(`Failed to send command: ${send.stderr || "unknown error"}`, "TMUX_COMMAND_FAILED"),
				);
			}

			const monitor = serveManager.start({
				sessionName: params.sessionName,
				command: params.command,
				windowName,
				socketPath: params.socketPath,
				pollIntervalSec: params.pollIntervalSec,
				readyPattern: params.readyPattern,
			});

			return buildToolResult({
				ok: true,
				...monitor,
				message: "Process started with crash monitoring. You will be alerted if it exits.",
			});
		},
	});

	const ServeStopParams = Type.Object({
		monitorId: Type.String({ description: "Monitor ID returned by tmux_serve" }),
		killSession: Type.Optional(Type.Boolean({ description: "Also kill the tmux session (default: false)" })),
	});

	pi.registerTool({
		name: "tmux_serve_stop",
		label: "tmux serve stop",
		description: "Stop monitoring a process started with tmux_serve. Optionally kill the tmux session.",
		parameters: ServeStopParams,
		async execute(_id, params) {
			const monitor = serveManager.stop(params.monitorId);
			if (!monitor) {
				return buildToolResult(makeToolError(`Monitor not found: ${params.monitorId}`, "INVALID_ARGUMENT"));
			}

			if (params.killSession === true) {
				const available = await tmuxAvailable(monitor.socketPath);
				if (available !== true) return buildToolResult(available);

				const kill = await runTmux(["kill-session", "-t", monitor.sessionName], {
					socketPath: monitor.socketPath,
					timeoutSec: 10,
				});
				if (!kill.ok) {
					return buildToolResult({
						ok: true,
						...monitor,
						warning: `Monitor stopped but failed to kill session: ${kill.stderr || "unknown error"}`,
					});
				}
				return buildToolResult({ ok: true, ...monitor, sessionKilled: true });
			}

			return buildToolResult({ ok: true, ...monitor });
		},
	});

	pi.registerTool({
		name: "tmux_serve_list",
		label: "tmux serve list",
		description: "List all active tmux_serve monitors and their status.",
		parameters: Type.Object({}),
		async execute() {
			const monitors = serveManager.list();
			return buildToolResult({ ok: true, monitors, count: monitors.length });
		},
	});
}
