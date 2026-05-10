import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CiWatchController, type CiWatchStateEntry, type ExecCall, type ExecResult } from "./core.ts";

const AUTO_START = false;
const CUSTOM_STATE_TYPE = "ci-watch-state";

const OPTIONS = {
	pollIntervalMs: 60_000,
	commandTimeoutMs: 30_000,
	watchTimeoutMs: 3 * 60 * 60 * 1000,
	includeCancelled: true,
	requiredOnly: false,
};

function isStateEntry(value: unknown): value is CiWatchStateEntry {
	if (!value || typeof value !== "object") return false;
	const candidate = value as Partial<CiWatchStateEntry>;
	return candidate.kind === "notified-failure" && typeof candidate.key === "string";
}

function restoredFailureKeys(entries: Array<{ type: string; customType?: string; data?: unknown }>): string[] {
	const keys: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CUSTOM_STATE_TYPE) continue;
		if (isStateEntry(entry.data)) keys.push(entry.data.key);
	}
	return keys;
}

function formatStatus(controller: CiWatchController | undefined): string {
	if (!controller) return "CI watch is not initialized yet.";

	const status = controller.status();
	const lines = [
		`CI watch: ${status.running ? "on" : "off"}`,
		`Poll in flight: ${status.pollInFlight ? "yes" : "no"}`,
		`Notified failures: ${status.notifiedFailures}`,
	];
	if (status.currentPr) {
		lines.push(`PR: #${status.currentPr.number} ${status.currentPr.title}`);
		lines.push(`Branch/SHA: ${status.currentPr.headRefName} ${status.currentPr.headRefOid.slice(0, 12)}`);
	}
	if (status.currentWatchKey) lines.push(`Watch key: ${status.currentWatchKey}`);
	if (status.lastError) lines.push(`Last error: ${status.lastError}`);
	return lines.join("\n");
}

export default function ciWatchExtension(pi: ExtensionAPI) {
	let controller: CiWatchController | undefined;

	pi.on("session_start", (_event, ctx) => {
		const exec = async (call: ExecCall): Promise<ExecResult> => {
			const result = await pi.exec(call.command, call.args, {
				cwd: call.cwd,
				timeout: call.timeoutMs,
				signal: call.signal,
			});
			return {
				code: result.code,
				stdout: result.stdout,
				stderr: result.stderr,
				killed: result.killed,
			};
		};

		controller = new CiWatchController(
			{
				cwd: ctx.cwd,
				exec,
				isIdle: () => ctx.isIdle(),
				sendUserMessage: (message, options) => pi.sendUserMessage(message, options),
				notify: (message, level) => ctx.ui.notify(message, level),
				appendState: (data) => pi.appendEntry(CUSTOM_STATE_TYPE, data),
			},
			OPTIONS,
			restoredFailureKeys(ctx.sessionManager.getEntries() as Array<{ type: string; customType?: string; data?: unknown }>),
		);

		if (AUTO_START) controller.start();
	});

	pi.on("session_shutdown", () => {
		controller?.stop();
		controller = undefined;
	});

	pi.registerCommand("ci-watch", {
		description: "Watch current branch PR CI and ask the agent for help if checks fail. Usage: /ci-watch on|off|status|now",
		handler: async (args, ctx) => {
			if (!controller) {
				ctx.ui.notify("CI watch is not initialized yet", "warning");
				return;
			}

			const action = args.trim().toLowerCase() || "status";
			if (action === "on" || action === "start") {
				controller.start();
				ctx.ui.notify("CI watch enabled for this session", "info");
				return;
			}

			if (action === "off" || action === "stop") {
				controller.stop();
				ctx.ui.notify("CI watch disabled", "info");
				return;
			}

			if (action === "now" || action === "poll") {
				await controller.pollNow();
				ctx.ui.notify(formatStatus(controller), "info");
				return;
			}

			if (action === "status") {
				ctx.ui.notify(formatStatus(controller), "info");
				return;
			}

			ctx.ui.notify("Usage: /ci-watch on|off|status|now", "warning");
		},
	});
}
