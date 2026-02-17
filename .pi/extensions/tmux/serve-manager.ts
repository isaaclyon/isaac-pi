import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { randomBytes } from "node:crypto";
import {
	DEFAULT_SERVE_POLL_SEC,
	DEFAULT_WINDOW,
	SERVE_GRACE_POLLS,
	SHELL_NAMES,
	nowEpochSec,
} from "./constants";
import { hasSession, runTmux } from "./client";
import type { ServeMonitorInfo, ServeStatus } from "./types";

interface ServeMonitorState {
	monitorId: string;
	sessionName: string;
	windowName: string;
	command: string;
	socketPath?: string;
	pollIntervalSec: number;
	readyPattern?: RegExp;
	startedAtEpoch: number;
	status: ServeStatus;
	processName?: string;
	readyAtEpoch?: number;
	crashedAtEpoch?: number;
	stoppedAtEpoch?: number;
	gracePollsRemaining: number;
	intervalHandle: ReturnType<typeof setInterval>;
	polling: boolean;
}

export interface ServeStartParams {
	sessionName: string;
	command: string;
	windowName?: string;
	socketPath?: string;
	pollIntervalSec?: number;
	readyPattern?: string;
}

function toInfo(m: ServeMonitorState): ServeMonitorInfo {
	return {
		monitorId: m.monitorId,
		sessionName: m.sessionName,
		windowName: m.windowName,
		command: m.command,
		socketPath: m.socketPath,
		status: m.status,
		processName: m.processName,
		startedAtEpoch: m.startedAtEpoch,
		readyAtEpoch: m.readyAtEpoch,
		crashedAtEpoch: m.crashedAtEpoch,
		stoppedAtEpoch: m.stoppedAtEpoch,
	};
}

export class ServeManager {
	private monitors = new Map<string, ServeMonitorState>();
	private nextId = 1;
	private pi: ExtensionAPI;
	private ctx: ExtensionContext | null = null;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	setContext(ctx: ExtensionContext): void {
		this.ctx = ctx;
	}

	start(params: ServeStartParams): ServeMonitorInfo {
		const monitorId = `serve-${this.nextId++}-${randomBytes(3).toString("hex")}`;
		const windowName = params.windowName || DEFAULT_WINDOW;
		const pollIntervalSec = Math.max(1, Math.floor(params.pollIntervalSec ?? DEFAULT_SERVE_POLL_SEC));

		let readyPattern: RegExp | undefined;
		if (params.readyPattern) {
			try {
				readyPattern = new RegExp(params.readyPattern);
			} catch {
				/* invalid regex — skip ready detection */
			}
		}

		const monitor: ServeMonitorState = {
			monitorId,
			sessionName: params.sessionName,
			windowName,
			command: params.command,
			socketPath: params.socketPath,
			pollIntervalSec,
			readyPattern,
			startedAtEpoch: nowEpochSec(),
			status: "starting",
			gracePollsRemaining: SERVE_GRACE_POLLS,
			intervalHandle: setInterval(() => this.poll(monitor), pollIntervalSec * 1000),
			polling: false,
		};

		this.monitors.set(monitorId, monitor);
		this.updateStatusDisplay(monitor);
		return toInfo(monitor);
	}

	stop(monitorId: string): ServeMonitorInfo | undefined {
		const monitor = this.monitors.get(monitorId);
		if (!monitor) return undefined;

		clearInterval(monitor.intervalHandle);
		monitor.status = "stopped";
		monitor.stoppedAtEpoch = nowEpochSec();
		this.monitors.delete(monitorId);
		this.clearStatusDisplay(monitor);
		return toInfo(monitor);
	}

	stopAll(): void {
		for (const monitor of this.monitors.values()) {
			clearInterval(monitor.intervalHandle);
			this.clearStatusDisplay(monitor);
		}
		this.monitors.clear();
	}

	list(): ServeMonitorInfo[] {
		return Array.from(this.monitors.values()).map(toInfo);
	}

	get(monitorId: string): ServeMonitorInfo | undefined {
		const m = this.monitors.get(monitorId);
		return m ? toInfo(m) : undefined;
	}

	// -- Polling ----------------------------------------------------------

	private async poll(monitor: ServeMonitorState): Promise<void> {
		if (monitor.polling) return;
		if (monitor.status === "crashed" || monitor.status === "stopped") return;

		monitor.polling = true;
		try {
			await this.doPoll(monitor);
		} finally {
			monitor.polling = false;
		}
	}

	private async doPoll(monitor: ServeMonitorState): Promise<void> {
		const exists = await hasSession(monitor.sessionName, monitor.socketPath);
		if (!exists) {
			this.handleCrash(monitor, "Session no longer exists", { triggerTurn: false });
			return;
		}

		const target = `${monitor.sessionName}:${monitor.windowName}`;
		const result = await runTmux(
			["list-panes", "-t", target, "-F", "#{pane_current_command}"],
			{ socketPath: monitor.socketPath, timeoutSec: 5 },
		);
		if (!result.ok) return; // transient failure — retry next cycle

		const currentCommand = result.stdout.trim().split("\n")[0]?.trim() || "";
		const isShell = SHELL_NAMES.has(currentCommand);

		if (monitor.status === "starting") {
			if (!isShell) {
				monitor.status = "running";
				monitor.processName = currentCommand;
				this.updateStatusDisplay(monitor);
				if (monitor.readyPattern) await this.checkReady(monitor);
			} else if (monitor.gracePollsRemaining > 0) {
				monitor.gracePollsRemaining--;
			} else {
				await this.handleCrashWithOutput(monitor, "Process exited immediately or failed to start");
			}
			return;
		}

		// status is "running" or "ready"
		if (isShell) {
			await this.handleCrashWithOutput(
				monitor,
				`Process '${monitor.processName || "unknown"}' exited`,
			);
			return;
		}

		if (monitor.status === "running" && monitor.readyPattern) {
			await this.checkReady(monitor);
		}
	}

	// -- Ready pattern detection ------------------------------------------

	private async checkReady(monitor: ServeMonitorState): Promise<void> {
		if (!monitor.readyPattern || monitor.status !== "running") return;

		const target = `${monitor.sessionName}:${monitor.windowName}`;
		const capture = await runTmux(
			["capture-pane", "-p", "-t", target, "-S", "-50"],
			{ socketPath: monitor.socketPath, timeoutSec: 5 },
		);
		if (!capture.ok) return;

		if (monitor.readyPattern.test(capture.stdout)) {
			monitor.status = "ready";
			monitor.readyAtEpoch = nowEpochSec();
			this.updateStatusDisplay(monitor);

			if (this.ctx?.hasUI) {
				this.ctx.ui.notify(
					`✅ ${monitor.sessionName}:${monitor.windowName} is ready`,
					"info",
				);
			}
		}
	}

	// -- Crash handling ---------------------------------------------------

	private async handleCrashWithOutput(
		monitor: ServeMonitorState,
		reason: string,
	): Promise<void> {
		const target = `${monitor.sessionName}:${monitor.windowName}`;
		const capture = await runTmux(
			["capture-pane", "-p", "-t", target, "-S", "-30"],
			{ socketPath: monitor.socketPath, timeoutSec: 5 },
		);
		const lastOutput = capture.ok ? capture.stdout.trim() : undefined;
		this.handleCrash(monitor, reason, { lastOutput, triggerTurn: true });
	}

	private handleCrash(
		monitor: ServeMonitorState,
		reason: string,
		options?: { lastOutput?: string; triggerTurn?: boolean },
	): void {
		if (!this.monitors.has(monitor.monitorId)) return; // already cleaned up

		clearInterval(monitor.intervalHandle);
		monitor.status = "crashed";
		monitor.crashedAtEpoch = nowEpochSec();
		this.monitors.delete(monitor.monitorId);
		this.clearStatusDisplay(monitor);

		if (this.ctx?.hasUI) {
			this.ctx.ui.notify(
				`💥 ${monitor.sessionName}:${monitor.windowName} crashed: ${reason}`,
				"error",
			);
		}

		const outputSnippet = options?.lastOutput
			? `\n\nLast output:\n\`\`\`\n${options.lastOutput.slice(-1000)}\n\`\`\``
			: "";

		this.pi.sendMessage(
			{
				customType: "tmux-serve-crash",
				content:
					`🚨 **tmux_serve crash detected**\n\n` +
					`- **Session:** ${monitor.sessionName}\n` +
					`- **Window:** ${monitor.windowName}\n` +
					`- **Command:** ${monitor.command}\n` +
					`- **Process:** ${monitor.processName || "unknown"}\n` +
					`- **Reason:** ${reason}\n` +
					`- **Monitor ID:** ${monitor.monitorId}` +
					outputSnippet +
					`\n\nThe monitored process has exited. ` +
					`Investigate with \`tmux_capture\` and restart with \`tmux_serve\`.`,
				display: true,
			},
			{ triggerTurn: options?.triggerTurn !== false },
		);
	}

	// -- UI helpers -------------------------------------------------------

	private updateStatusDisplay(monitor: ServeMonitorState): void {
		if (!this.ctx?.hasUI) return;

		const icon = monitor.status === "ready" ? "✅" : "⚡";
		const proc = monitor.processName || "starting";
		const text = `${icon} ${monitor.sessionName}:${monitor.windowName}: ${proc} (${monitor.status})`;
		this.ctx.ui.setStatus(`tmux-serve-${monitor.monitorId}`, text);
	}

	private clearStatusDisplay(monitor: ServeMonitorState): void {
		if (!this.ctx?.hasUI) return;
		this.ctx.ui.setStatus(`tmux-serve-${monitor.monitorId}`, undefined);
	}
}
