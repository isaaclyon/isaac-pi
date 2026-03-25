/**
 * open-file extension
 *
 * Makes file paths in tool call headers clickable via OSC 8 terminal hyperlinks
 * (open in default macOS app). Also provides:
 *   /open [path]        → open in default app
 *   /open -c [path]     → open in VS Code
 *   Ctrl+Shift+O        → pick from recently-seen paths
 */
import type {
	BashToolDetails,
	EditToolDetails,
	ExtensionAPI,
	ReadToolDetails,
} from "@mariozechner/pi-coding-agent";
import {
	createBashTool,
	createEditTool,
	createFindTool,
	createGrepTool,
	createLsTool,
	createReadTool,
	createWriteTool,
} from "@mariozechner/pi-coding-agent";
import { Key, Text } from "@mariozechner/pi-tui";
import { exec } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

// OSC 8 hyperlink: ESC ] 8 ; ; URL ST  display-text  ESC ] 8 ; ; ST
function osc8(url: string, display: string): string {
	return `\x1b]8;;${url}\x1b\\${display}\x1b]8;;\x1b\\`;
}

// Wrap a (possibly ANSI-styled) display string with a file:// OSC 8 link.

function toFileUrl(p: string): string {
	// Expand ~ and resolve to absolute before building the file:// URL.
	const abs = p.startsWith("~") ? homedir() + p.slice(1) : p;
	return "file://" + resolve(abs).replace(/ /g, "%20");
}

function fileLink(path: string, display: string): string {
	return osc8(toFileUrl(path), display);
}

function openPath(absolutePath: string, app?: string): void {
	const escaped = absolutePath.replace(/'/g, "'\\''");
	const cmd = app ? `open -a '${app}' -- '${escaped}'` : `open -- '${escaped}'`;
	exec(cmd);
}

export default function (pi: ExtensionAPI) {
	const cwd = process.cwd();
	const recentPaths: string[] = [];

	function track(p: string | undefined) {
		if (!p) return;
		const idx = recentPaths.indexOf(p);
		if (idx !== -1) recentPaths.splice(idx, 1);
		recentPaths.unshift(p);
		if (recentPaths.length > 60) recentPaths.pop();
	}

	// ── read ─────────────────────────────────────────────────────────────────
	const origRead = createReadTool(cwd);
	pi.registerTool({
		name: "read",
		label: "read",
		description: origRead.description,
		parameters: origRead.parameters,
		async execute(id, params, signal, onUpdate) {
			return origRead.execute(id, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			track(args.path);
			let text = theme.fg("toolTitle", theme.bold("read "));
			text += fileLink(args.path, theme.fg("accent", args.path));
			if (args.offset || args.limit) {
				const parts: string[] = [];
				if (args.offset) parts.push(`offset=${args.offset}`);
				if (args.limit) parts.push(`limit=${args.limit}`);
				text += theme.fg("dim", ` (${parts.join(", ")})`);
			}
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Reading…"), 0, 0);
			const details = result.details as ReadToolDetails | undefined;
			const content = result.content[0];
			if (content?.type === "image") {
				return new Text(theme.fg("success", "Image loaded"), 0, 0);
			}
			if (content?.type !== "text") {
				return new Text(theme.fg("error", "No content"), 0, 0);
			}
			const lines = content.text.split("\n");
			let text = theme.fg("success", `${lines.length} lines`);
			if (details?.truncation?.truncated) {
				text += theme.fg("warning", ` (truncated from ${details.truncation.totalLines})`);
			}
			if (expanded) {
				for (const line of lines.slice(0, 15)) {
					text += `\n${theme.fg("dim", line)}`;
				}
				if (lines.length > 15) {
					text += `\n${theme.fg("muted", `… ${lines.length - 15} more lines`)}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});

	// ── write ────────────────────────────────────────────────────────────────
	const origWrite = createWriteTool(cwd);
	pi.registerTool({
		name: "write",
		label: "write",
		description: origWrite.description,
		parameters: origWrite.parameters,
		async execute(id, params, signal, onUpdate) {
			return origWrite.execute(id, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			track(args.path);
			let text = theme.fg("toolTitle", theme.bold("write "));
			text += fileLink(args.path, theme.fg("accent", args.path));
			const lineCount = (args.content ?? "").split("\n").length;
			text += theme.fg("dim", ` (${lineCount} lines)`);
			return new Text(text, 0, 0);
		},
		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Writing…"), 0, 0);
			const content = result.content[0];
			if (content?.type === "text" && content.text.startsWith("Error")) {
				return new Text(theme.fg("error", content.text.split("\n")[0] ?? "Error"), 0, 0);
			}
			return new Text(theme.fg("success", "Written"), 0, 0);
		},
	});

	// ── edit ─────────────────────────────────────────────────────────────────
	const origEdit = createEditTool(cwd);
	pi.registerTool({
		name: "edit",
		label: "edit",
		description: origEdit.description,
		parameters: origEdit.parameters,
		async execute(id, params, signal, onUpdate) {
			return origEdit.execute(id, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			track(args.path);
			let text = theme.fg("toolTitle", theme.bold("edit "));
			text += fileLink(args.path, theme.fg("accent", args.path));
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Editing…"), 0, 0);
			const details = result.details as EditToolDetails | undefined;
			const content = result.content[0];
			if (content?.type === "text" && content.text.startsWith("Error")) {
				return new Text(theme.fg("error", content.text.split("\n")[0] ?? "Error"), 0, 0);
			}
			if (!details?.diff) {
				return new Text(theme.fg("success", "Applied"), 0, 0);
			}
			const diffLines = details.diff.split("\n");
			let add = 0;
			let rem = 0;
			for (const l of diffLines) {
				if (l.startsWith("+") && !l.startsWith("+++")) add++;
				if (l.startsWith("-") && !l.startsWith("---")) rem++;
			}
			let text = theme.fg("success", `+${add}`);
			text += theme.fg("dim", " / ");
			text += theme.fg("error", `-${rem}`);
			if (expanded) {
				for (const l of diffLines.slice(0, 30)) {
					if (l.startsWith("+") && !l.startsWith("+++")) text += `\n${theme.fg("success", l)}`;
					else if (l.startsWith("-") && !l.startsWith("---")) text += `\n${theme.fg("error", l)}`;
					else text += `\n${theme.fg("dim", l)}`;
				}
				if (diffLines.length > 30) {
					text += `\n${theme.fg("muted", `… ${diffLines.length - 30} more diff lines`)}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});

	// ── bash ─────────────────────────────────────────────────────────────────
	const origBash = createBashTool(cwd);
	pi.registerTool({
		name: "bash",
		label: "bash",
		description: origBash.description,
		parameters: origBash.parameters,
		async execute(id, params, signal, onUpdate) {
			return origBash.execute(id, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("$ "));
			const cmd = args.command.length > 80 ? `${args.command.slice(0, 77)}…` : args.command;
			text += theme.fg("accent", cmd);
			if (args.timeout) {
				text += theme.fg("dim", ` (timeout: ${args.timeout}s)`);
			}
			return new Text(text, 0, 0);
		},
		renderResult(result, { expanded, isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Running…"), 0, 0);
			const details = result.details as BashToolDetails | undefined;
			const content = result.content[0];
			const output = content?.type === "text" ? content.text : "";
			const exitMatch = output.match(/exit code: (\d+)/);
			const exitCode = exitMatch ? parseInt(exitMatch[1]!, 10) : null;
			const lineCount = output.split("\n").filter((l) => l.trim()).length;
			let text =
				exitCode === 0 || exitCode === null
					? theme.fg("success", "done")
					: theme.fg("error", `exit ${exitCode}`);
			text += theme.fg("dim", ` (${lineCount} lines)`);
			if (details?.truncation?.truncated) {
				text += theme.fg("warning", " [truncated]");
			}
			if (expanded) {
				for (const line of output.split("\n").slice(0, 20)) {
					text += `\n${theme.fg("dim", line)}`;
				}
				if (output.split("\n").length > 20) {
					text += `\n${theme.fg("muted", "… more output")}`;
				}
			}
			return new Text(text, 0, 0);
		},
	});

	// ── grep ─────────────────────────────────────────────────────────────────
	const origGrep = createGrepTool(cwd);
	pi.registerTool({
		name: "grep",
		label: "grep",
		description: origGrep.description,
		parameters: origGrep.parameters,
		async execute(id, params, signal, onUpdate) {
			return origGrep.execute(id, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			track(args.path);
			let text = theme.fg("toolTitle", theme.bold("grep "));
			text += theme.fg("accent", `"${args.pattern}"`);
			if (args.path) {
				text += theme.fg("dim", " in ") + fileLink(args.path, theme.fg("accent", args.path));
			}
			if (args.glob) text += theme.fg("dim", ` (${args.glob})`);
			return new Text(text, 0, 0);
		},
		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Searching…"), 0, 0);
			const content = result.content[0];
			const output = content?.type === "text" ? content.text : "";
			const lineCount = output.split("\n").filter((l) => l.trim()).length;
			const text = lineCount > 0 ? theme.fg("success", `${lineCount} matches`) : theme.fg("muted", "0 matches");
			return new Text(text, 0, 0);
		},
	});

	// ── find ─────────────────────────────────────────────────────────────────
	const origFind = createFindTool(cwd);
	pi.registerTool({
		name: "find",
		label: "find",
		description: origFind.description,
		parameters: origFind.parameters,
		async execute(id, params, signal, onUpdate) {
			return origFind.execute(id, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			track(args.path);
			let text = theme.fg("toolTitle", theme.bold("find "));
			text += theme.fg("accent", `"${args.pattern}"`);
			if (args.path) {
				text += theme.fg("dim", " in ") + fileLink(args.path, theme.fg("accent", args.path));
			}
			return new Text(text, 0, 0);
		},
		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Finding…"), 0, 0);
			const content = result.content[0];
			const output = content?.type === "text" ? content.text : "";
			const count = output.split("\n").filter((l) => l.trim()).length;
			const text = count > 0 ? theme.fg("success", `${count} files`) : theme.fg("muted", "0 files");
			return new Text(text, 0, 0);
		},
	});

	// ── ls ───────────────────────────────────────────────────────────────────
	const origLs = createLsTool(cwd);
	pi.registerTool({
		name: "ls",
		label: "ls",
		description: origLs.description,
		parameters: origLs.parameters,
		async execute(id, params, signal, onUpdate) {
			return origLs.execute(id, params, signal, onUpdate);
		},
		renderCall(args, theme) {
			track(args.path);
			let text = theme.fg("toolTitle", theme.bold("ls "));
			if (args.path) {
				text += fileLink(args.path, theme.fg("accent", args.path));
			} else {
				text += theme.fg("dim", "(cwd)");
			}
			return new Text(text, 0, 0);
		},
		renderResult(result, { isPartial }, theme) {
			if (isPartial) return new Text(theme.fg("warning", "Listing…"), 0, 0);
			const content = result.content[0];
			const output = content?.type === "text" ? content.text : "";
			const count = output.split("\n").filter((l) => l.trim()).length;
			const text = count > 0 ? theme.fg("success", `${count} entries`) : theme.fg("muted", "empty");
			return new Text(text, 0, 0);
		},
	});

	// ── /open command ────────────────────────────────────────────────────────
	pi.registerCommand("open", {
		description: "Open a file  ·  /open [path]  ·  /open -c [path] for VS Code  ·  no args = pick from recent",
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			let app: string | undefined;
			let pathArg = trimmed;

			if (trimmed.startsWith("-c ")) {
				app = "Visual Studio Code";
				pathArg = trimmed.slice(3).trim();
			}

			if (!pathArg) {
				if (recentPaths.length === 0) {
					ctx.ui.notify("No recent file paths recorded yet", "warning");
					return;
				}
				const chosen = await ctx.ui.select("Open file:", recentPaths);
				if (!chosen) return;
				pathArg = chosen;
			}

			openPath(pathArg, app);
			ctx.ui.notify(`Opening: ${pathArg}`, "info");
		},
	});

	// ── Ctrl+Shift+O shortcut ─────────────────────────────────────────────────
	pi.registerShortcut(Key.ctrlShift("o"), {
		description: "Open a recently-seen file",
		handler: async (ctx) => {
			if (recentPaths.length === 0) {
				ctx.ui.notify("No recent file paths recorded yet", "warning");
				return;
			}
			const chosen = await ctx.ui.select("Open file:", recentPaths);
			if (!chosen) return;
			openPath(chosen);
			ctx.ui.notify(`Opening: ${chosen}`, "info");
		},
	});
}
