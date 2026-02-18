/**
 * Move Session Extension
 *
 * Moves the current session into another cwd and relaunches pi there.
 * Conversation history carries over via SessionManager.forkFrom().
 *
 * Usage:
 *   /move-session <targetCwd>
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { SessionManager } from "@mariozechner/pi-coding-agent";
import { spawn } from "node:child_process";
import { statSync } from "node:fs";

const TRASH_TIMEOUT_MS = 5000;

export default function moveSessionExtension(pi: ExtensionAPI): void {
	const trashFileBestEffort = async (filePath: string): Promise<void> => {
		try {
			const { code } = await pi.exec("trash", [filePath], { timeout: TRASH_TIMEOUT_MS });
			if (code === 0) return;
		} catch {
			// ignore — never permanently delete session files
		}
	};

	pi.registerCommand("move-session", {
		description: "Move session to another directory and relaunch pi there",
		handler: async (args, ctx) => {
			await ctx.waitForIdle();

			const rawTargetCwd = args.trim();
			if (!rawTargetCwd) {
				ctx.ui.notify("Usage: /move-session <targetCwd>", "error");
				return;
			}

			// Expand ~ to home directory
			let targetCwd = rawTargetCwd;
			if (/^~(?=$|\/)/.test(rawTargetCwd)) {
				const home = process.env.HOME ?? process.env.USERPROFILE;
				if (!home) {
					ctx.ui.notify("Cannot expand '~': $HOME is not set", "error");
					return;
				}
				targetCwd = rawTargetCwd.replace(/^~(?=$|\/)/, home);
			}

			// Validate target path
			let targetCwdStat;
			try {
				targetCwdStat = statSync(targetCwd);
			} catch (error: unknown) {
				const code = (error as NodeJS.ErrnoException).code;
				if (code === "ENOENT") {
					ctx.ui.notify(`Path does not exist: ${targetCwd}`, "error");
				} else {
					ctx.ui.notify(`Cannot access path: ${targetCwd}`, "error");
				}
				return;
			}

			if (!targetCwdStat.isDirectory()) {
				ctx.ui.notify(`Not a directory: ${targetCwd}`, "error");
				return;
			}

			const sourceSessionFile = ctx.sessionManager.getSessionFile();
			if (!sourceSessionFile) {
				ctx.ui.notify("No persistent session file (maybe started with --no-session)", "error");
				return;
			}

			try {
				const forked = SessionManager.forkFrom(sourceSessionFile, targetCwd);
				const destSessionFile = forked.getSessionFile();

				if (!destSessionFile) {
					ctx.ui.notify("Internal error: forkFrom() produced no session file", "error");
					return;
				}

				// Tear down the parent's terminal usage before spawning
				process.stdout.write("\x1b[<u"); // Pop kitty keyboard protocol
				process.stdout.write("\x1b[?2004l"); // Disable bracketed paste
				process.stdout.write("\x1b[?25h"); // Show cursor
				process.stdout.write("\r\n");

				if (process.stdin.isTTY && process.stdin.setRawMode) {
					process.stdin.setRawMode(false);
				}

				// Spawn new pi in the target directory
				const child = spawn("pi", ["--session", destSessionFile], {
					cwd: targetCwd,
					stdio: "inherit",
				});

				child.once("spawn", () => {
					// Trash the old session file after the new process is running
					void trashFileBestEffort(sourceSessionFile);

					// Stop the parent from stealing keypresses
					process.stdin.removeAllListeners();
					process.stdin.destroy();

					// Ignore signals — the child owns the terminal now
					process.removeAllListeners("SIGINT");
					process.removeAllListeners("SIGTERM");
					process.on("SIGINT", () => {});
					process.on("SIGTERM", () => {});
				});

				child.on("exit", (code) => process.exit(code ?? 0));
				child.on("error", (err) => {
					process.stderr.write(`Failed to launch pi: ${err.message}\n`);
					process.exit(1);
				});
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				ctx.ui.notify(`Failed to move session: ${message}`, "error");
			}
		},
	});
}
