import { spawn } from "node:child_process";

type RunCommandOptions = {
	cwd?: string;
};

export type BuildPiCommandInput = {
	task: string;
	model: string | null;
	tools: string[] | null;
	appendSystemPrompt?: string;
	outputPath: string;
};

export function buildSessionName(input: { prefix: string; runId: string; loopNumber: number }): string {
	const safePrefix = input.prefix.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "ralph";
	const safeRun = input.runId.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 10) || "run";
	const suffix = String(input.loopNumber).padStart(2, "0");
	return `${safePrefix}-${safeRun}-${suffix}`;
}

function shellEscape(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildPiCommand(input: BuildPiCommandInput): string {
	const parts: string[] = ["pi", "--mode", "json", "-p", "--no-session"];
	if (input.model) {
		parts.push("--model", input.model);
	}
	if (input.tools && input.tools.length > 0) {
		parts.push("--tools", input.tools.join(","));
	}
	if (input.appendSystemPrompt && input.appendSystemPrompt.trim()) {
		parts.push("--append-system-prompt", input.appendSystemPrompt.trim());
	}
	parts.push(`Task: ${input.task}`);
	const cmd = parts.map(shellEscape).join(" ");
	return `${cmd} > ${shellEscape(input.outputPath)} 2>&1`;
}

function runTmux(args: string[], options: RunCommandOptions = {}): Promise<void> {
	return new Promise((resolve, reject) => {
		const proc = spawn("tmux", args, {
			cwd: options.cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stderr = "";
		proc.stderr.on("data", (chunk) => {
			stderr += String(chunk);
		});
		proc.on("error", reject);
		proc.on("close", (code) => {
			if (code === 0) resolve();
			else reject(new Error(`tmux ${args.join(" ")} failed with code ${code}: ${stderr.trim()}`));
		});
	});
}

export async function startDetachedSession(input: {
	sessionName: string;
	command: string;
	cwd?: string;
}): Promise<void> {
	await runTmux(["new-session", "-d", "-s", input.sessionName, input.command], { cwd: input.cwd });
}

export async function stopSession(sessionName: string): Promise<void> {
	await runTmux(["kill-session", "-t", sessionName]);
}
