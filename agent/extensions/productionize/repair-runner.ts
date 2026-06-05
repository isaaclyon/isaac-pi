import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ActiveRepairState, RepairAttemptOutcome } from "./auto.ts";
import type { StepId } from "./core.ts";

const SESSION_DIR = path.join(os.tmpdir(), "productionize-auto-sessions");
const GITHUB_ENV_KEYS = ["GH_TOKEN", "GITHUB_TOKEN", "GITHUB_ENTERPRISE_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_AUTH_TOKEN"];
const ALLOWED_TOOLS = ["read", "edit", "write"] as const;

export interface RepairRunnerInput {
	cwd: string;
	stepId: StepId;
	branch: string;
	baseBranch: string;
	prompt: string;
	model?: string;
	abortSignal?: AbortSignal;
	previousRepair?: ActiveRepairState;
}

export interface RepairProtocolState {
	sawSessionHeader: boolean;
	sawAssistantMessageEnd: boolean;
	sawToolExecutionEnd: boolean;
	lastSeenEventType?: string;
	terminalState: "completed" | "failed" | "cancelled";
}

export interface RepairAttemptSummary {
	stepId: StepId;
	headShaBefore: string;
	headShaAfter?: string;
	baseBranch: string;
	baseShaBefore: string;
	sessionFile: string;
	childToken: string;
	spawnTimestamp: string;
	pid?: number;
	outcome: RepairAttemptOutcome;
	summary: string;
	patchFile: string;
	patch: string;
	tempRoot: string;
	tempWorktree: string;
	lastSeenEventType?: string;
	lastSummarizedText?: string;
	verifiedCommand: {
		command: string;
		args: string[];
		cwd: string;
		tools: string[];
	};
	protocol: RepairProtocolState;
	errorMessage?: string;
}

export interface RepairRunnerUpdate {
	sessionFile?: string;
	lastSeenEventType?: string;
	lastSummarizedText?: string;
	pid?: number;
	childToken?: string;
	spawnTimestamp?: string;
	verifiedCommand?: RepairAttemptSummary["verifiedCommand"];
	tempWorktree?: string;
}

export interface RepairRunner {
	start(input: RepairRunnerInput, onUpdate?: (update: RepairRunnerUpdate) => void): Promise<RepairAttemptSummary>;
	abort(): void;
}

interface CommandResult {
	code: number;
	stdout: string;
	stderr: string;
}

interface RunnerDeps {
	spawnProcess?: typeof spawn;
	randomToken?: () => string;
	now?: () => Date;
}

export function createRepairRunner(deps: RunnerDeps = {}): RepairRunner {
	const spawnProcess = deps.spawnProcess ?? spawn;
	const randomToken = deps.randomToken ?? (() => randomUUID());
	const now = deps.now ?? (() => new Date());
	let activeProc: ChildProcessWithoutNullStreams | undefined;

	return {
		abort() {
			if (!activeProc) return;
			terminateProcess(activeProc);
		},
		async start(input, onUpdate) {
			if (input.previousRepair) {
				await killVerifiedOrphan(input.previousRepair);
			}

			const headShaBefore = await gitStdout(input.cwd, ["rev-parse", "HEAD"]);
			const baseShaBefore = await gitStdout(input.cwd, ["rev-parse", input.baseBranch]);
			const spawnTimestamp = now().toISOString();
			const token = randomToken();
			const spawnSlug = spawnTimestamp.replace(/[:.]/g, "-");
			const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `productionize-auto-${spawnSlug}-${token}-`));
			const tempWorktree = path.join(tempRoot, `worktree-${spawnSlug}-${token}`);
			const patchFile = path.join(tempRoot, `repair-${spawnSlug}-${token}.patch`);
			const sessionFile = await createSessionFilePath(spawnSlug, token);
			await runGit(input.cwd, ["worktree", "add", "--detach", tempWorktree, "HEAD"], "Failed to create repair worktree.");
			await syncWorkingTree(input.cwd, tempWorktree);

			const args = buildPiArgs(sessionFile, input.prompt, input.model);
			const invocation = getPiInvocation(args);
			const verifiedCommand = {
				command: invocation.command,
				args: [...invocation.args],
				cwd: tempWorktree,
				tools: [...ALLOWED_TOOLS],
			};
			onUpdate?.({
				sessionFile,
				childToken: token,
				spawnTimestamp,
				verifiedCommand,
				tempWorktree,
			});

			const protocol: RepairProtocolState = {
				sawSessionHeader: false,
				sawAssistantMessageEnd: false,
				sawToolExecutionEnd: false,
				terminalState: "completed",
			};
			let lastSummarizedText: string | undefined;
			let stderr = "";
			let cancelled = false;
			let exitCode = 0;

			await fs.mkdir(path.dirname(sessionFile), { recursive: true });
			activeProc = spawnProcess(invocation.command, invocation.args, {
				cwd: tempWorktree,
				shell: false,
				stdio: ["ignore", "pipe", "pipe"],
				env: buildChildEnv(tempWorktree),
			});
			onUpdate?.({ pid: activeProc.pid });

			const abortHandler = () => {
				cancelled = true;
				if (activeProc) terminateProcess(activeProc);
			};
			input.abortSignal?.addEventListener("abort", abortHandler, { once: true });

			try {
				exitCode = await new Promise<number>((resolve, reject) => {
					if (!activeProc) {
						reject(new Error("Repair process was not started."));
						return;
					}

					let buffer = "";
					const processLine = (line: string) => {
						if (!line.trim()) return;
						let event: any;
						try {
							event = JSON.parse(line);
						} catch {
							return;
						}

						protocol.lastSeenEventType = event.type;
						onUpdate?.({ lastSeenEventType: event.type });

						if (event.type === "session") {
							protocol.sawSessionHeader = true;
						}
						if (event.type === "message_end" && event.message?.role === "assistant") {
							protocol.sawAssistantMessageEnd = true;
							const text = assistantText(event.message);
							if (text) {
								lastSummarizedText = text;
								onUpdate?.({ lastSummarizedText: text });
							}
						}
						if (event.type === "tool_execution_end" || event.type === "tool_result_end") {
							protocol.sawToolExecutionEnd = true;
						}
					};

					activeProc.stdout.on("data", (chunk) => {
						buffer += chunk.toString();
						const lines = buffer.split("\n");
						buffer = lines.pop() ?? "";
						for (const line of lines) processLine(line);
					});
					activeProc.stderr.on("data", (chunk) => {
						stderr += chunk.toString();
					});
					activeProc.on("close", (code) => {
						if (buffer.trim()) processLine(buffer);
						resolve(code ?? 0);
					});
					activeProc.on("error", (error) => reject(error));
				});
			} finally {
				input.abortSignal?.removeEventListener("abort", abortHandler);
				activeProc = undefined;
			}

			const patch = await exportPatchArtifact(tempWorktree, patchFile);
			const outcome: RepairAttemptOutcome = cancelled ? "cancelled" : exitCode === 0 ? "succeeded" : "failed";
			protocol.terminalState = outcome === "succeeded" ? "completed" : outcome;
			const summary = buildSummary(input.stepId, outcome, lastSummarizedText, stderr, patch);

			return {
				stepId: input.stepId,
				headShaBefore,
				baseBranch: input.baseBranch,
				baseShaBefore,
				sessionFile,
				childToken: token,
				spawnTimestamp,
				pid: undefined,
				outcome,
				summary,
				patchFile,
				patch,
				tempRoot,
				tempWorktree,
				lastSeenEventType: protocol.lastSeenEventType,
				lastSummarizedText,
				verifiedCommand,
				protocol,
				errorMessage: outcome === "failed" ? stderr.trim() || lastSummarizedText : undefined,
			};
		},
	};
}

export async function killVerifiedOrphan(repair: ActiveRepairState): Promise<boolean> {
	if (!repair.pid || !repair.childToken || !repair.spawnTimestamp || !repair.verifiedCommand) return false;
	if (!(await isPidAlive(repair.pid))) return false;
	const verified = await verifyRunningChild(repair);
	if (!verified) return false;
	try {
		process.kill(repair.pid, "SIGTERM");
	} catch {
		return false;
	}
	const started = Date.now();
	while (Date.now() - started < 5_000) {
		if (!(await isPidAlive(repair.pid))) return true;
		await delay(100);
	}
	try {
		process.kill(repair.pid, "SIGKILL");
	} catch {
		return false;
	}
	return true;
}

export async function verifyRunningChild(repair: ActiveRepairState): Promise<boolean> {
	if (!repair.pid || !repair.childToken || !repair.spawnTimestamp || !repair.verifiedCommand) return false;
	if (!(await isPidAlive(repair.pid))) return false;
	const ps = await runCommand("ps", ["-p", String(repair.pid), "-o", "command="], process.cwd());
	if (ps.code !== 0) return false;
	const commandLine = `${ps.stdout} ${ps.stderr}`;
	return (
		commandLine.includes(repair.childToken) &&
		commandLine.includes(repair.spawnTimestamp.replace(/[:.]/g, "-")) &&
		commandLine.includes(path.basename(repair.verifiedCommand.command))
	);
}

export async function exportPatchArtifact(tempWorktree: string, patchFile: string): Promise<string> {
	await runGit(tempWorktree, ["add", "-A"], "Failed to stage repair worktree changes.");
	const diff = await runCommand("git", ["diff", "--cached", "--binary", "--full-index", "HEAD"], tempWorktree);
	if (diff.code !== 0) {
		throw new Error(diff.stderr.trim() || "Failed to export repair patch.");
	}
	await fs.writeFile(patchFile, diff.stdout, "utf8");
	return diff.stdout;
}

export async function cleanupRepairArtifacts(summary: RepairAttemptSummary): Promise<void> {
	try {
		await runCommand("git", ["worktree", "remove", "--force", summary.tempWorktree], summary.tempWorktree);
	} catch {
		/* ignore */
	}
	await fs.rm(summary.tempRoot, { recursive: true, force: true });
}

export function getPiInvocation(args: string[]): { command: string; args: string[] } {
	const currentScript = process.argv[1];
	const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
	if (currentScript && !isBunVirtualScript) {
		return { command: process.execPath, args: [currentScript, ...args] };
	}
	const execName = path.basename(process.execPath).toLowerCase();
	const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
	if (!isGenericRuntime) return { command: process.execPath, args };
	return { command: "pi", args };
}

export async function syncWorkingTree(sourceDir: string, targetDir: string): Promise<void> {
	const sourceEntries = await fs.readdir(sourceDir, { withFileTypes: true });
	const targetEntries = new Map(
		(await fs.readdir(targetDir, { withFileTypes: true }))
			.filter((entry) => entry.name !== ".git")
			.map((entry) => [entry.name, entry]),
	);

	for (const entry of sourceEntries) {
		if (entry.name === ".git") continue;
		const sourcePath = path.join(sourceDir, entry.name);
		const targetPath = path.join(targetDir, entry.name);
		targetEntries.delete(entry.name);
		if (entry.isDirectory()) {
			await fs.mkdir(targetPath, { recursive: true });
			await syncWorkingTree(sourcePath, targetPath);
			continue;
		}
		if (entry.isSymbolicLink()) {
			const linkTarget = await fs.readlink(sourcePath);
			await fs.rm(targetPath, { recursive: true, force: true });
			await fs.symlink(linkTarget, targetPath);
			continue;
		}
		await fs.mkdir(path.dirname(targetPath), { recursive: true });
		await fs.copyFile(sourcePath, targetPath);
	}

	for (const [name] of targetEntries) {
		await fs.rm(path.join(targetDir, name), { recursive: true, force: true });
	}
}

function buildPiArgs(sessionFile: string, prompt: string, model?: string): string[] {
	const guardPath = decodeURIComponent(path.resolve(path.dirname(new URL(import.meta.url).pathname), "repair-guard.ts"));
	const args = [
		"--mode",
		"json",
		"-p",
		"--session",
		sessionFile,
		"--tools",
		ALLOWED_TOOLS.join(","),
		"--no-extensions",
		"--extension",
		guardPath,
	];
	if (model) args.push("--model", model);
	args.push(prompt);
	return args;
}

async function createSessionFilePath(spawnSlug: string, token: string): Promise<string> {
	await fs.mkdir(SESSION_DIR, { recursive: true });
	return path.join(SESSION_DIR, `repair-${spawnSlug}-${token}.jsonl`);
}

function buildChildEnv(rootDir: string): NodeJS.ProcessEnv {
	const env = { ...process.env };
	for (const key of GITHUB_ENV_KEYS) delete env[key];
	env.PRODUCTIONIZE_AUTO_ROOT = rootDir;
	return env;
}

function assistantText(message: { content?: unknown }): string | undefined {
	if (!Array.isArray(message.content)) return undefined;
	const text = message.content
		.map((part) => (part && typeof part === "object" && "type" in part && part.type === "text" ? String((part as any).text) : ""))
		.filter(Boolean)
		.join("\n")
		.trim();
	return text || undefined;
}

function buildSummary(stepId: StepId, outcome: RepairAttemptOutcome, lastText: string | undefined, stderr: string, patch: string): string {
	const detail = lastText ?? stderr.trim() ?? "";
	const fallback = patch.trim() ? "Patch exported for import." : "No patch changes exported.";
	return `Repair ${outcome} for ${stepId}: ${detail || fallback}`;
}

async function gitStdout(cwd: string, args: string[]): Promise<string> {
	const result = await runGit(cwd, args, `git ${args.join(" ")} failed.`);
	return result.stdout.trim();
}

async function runGit(cwd: string, args: string[], errorMessage: string): Promise<CommandResult> {
	const result = await runCommand("git", args, cwd);
	if (result.code !== 0) throw new Error(result.stderr.trim() || errorMessage);
	return result;
}

async function runCommand(command: string, args: string[], cwd: string): Promise<CommandResult> {
	return await new Promise<CommandResult>((resolve, reject) => {
		const proc = spawn(command, args, { cwd, shell: false, stdio: ["ignore", "pipe", "pipe"] });
		let stdout = "";
		let stderr = "";
		proc.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		proc.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		proc.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
		proc.on("error", reject);
	});
}

async function isPidAlive(pid: number): Promise<boolean> {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function terminateProcess(proc: ChildProcessWithoutNullStreams): void {
	proc.kill("SIGTERM");
	setTimeout(() => {
		if (!proc.killed) proc.kill("SIGKILL");
	}, 5_000);
}

function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
