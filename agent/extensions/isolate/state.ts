import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { IsolationState } from "./types.ts";

const ISOLATION_PHASES = new Set([
	"creating",
	"active",
	"finish_requested",
	"integrating",
	"conflicted",
	"ff_pending",
	"integrated",
	"cleanup_pending",
	"discarding",
	"done",
]);

export function isolationStatePath(commonDir: string): string {
	return join(commonDir, "pi-isolate", "state.json");
}

export async function loadIsolationState(commonDir: string): Promise<IsolationState | undefined> {
	try {
		const parsed: unknown = JSON.parse(await readFile(isolationStatePath(commonDir), "utf8"));
		if (!isIsolationState(parsed)) throw new Error(`Invalid Pi isolation state in ${isolationStatePath(commonDir)}`);
		if (resolve(parsed.gitCommonDir) !== resolve(commonDir)) {
			throw new Error(`Pi isolation manifest Git common directory does not match ${resolve(commonDir)}.`);
		}
		return parsed;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
		throw error;
	}
}

export async function saveIsolationState(state: IsolationState): Promise<void> {
	const path = isolationStatePath(state.gitCommonDir);
	await mkdir(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
	await rename(temporary, path);
}

export async function clearIsolationState(commonDir: string): Promise<void> {
	await rm(isolationStatePath(commonDir), { force: true });
}

export async function withIsolationLock<T>(commonDir: string, operation: () => Promise<T>): Promise<T> {
	const directory = join(commonDir, "pi-isolate");
	const path = join(directory, "transition.lock");
	await mkdir(directory, { recursive: true });
	let handle;
	try {
		try {
			handle = await open(path, "wx", 0o600);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (!(await removeStaleLock(path))) {
				throw new Error("Another Pi isolation transition is already in progress for this repository.", { cause: error });
			}
			try {
				handle = await open(path, "wx", 0o600);
			} catch (retryError) {
				throw new Error("Another Pi isolation transition is already in progress for this repository.", { cause: retryError });
			}
		}
		await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
		return await operation();
	} finally {
		await handle?.close();
		if (handle) await rm(path, { force: true });
	}
}

async function removeStaleLock(path: string): Promise<boolean> {
	try {
		const parsed = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; createdAt?: unknown };
		if (typeof parsed.pid === "number" && !isProcessAlive(parsed.pid)) {
			await rm(path, { force: true });
			return true;
		}
	} catch {
		return false;
	}
	return false;
}

function isProcessAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

export function isIsolationState(value: unknown): value is IsolationState {
	if (!value || typeof value !== "object") return false;
	const state = value as Partial<IsolationState>;
	const requiredStrings = [
		state.id,
		state.task,
		state.createdAt,
		state.repositoryRoot,
		state.gitCommonDir,
		state.baseBranch,
		state.baseHead,
		state.sourceCwd,
		state.sourceSessionFile,
		state.worktreePath,
		state.worktreeCwd,
		state.worktreeBranch,
	];
	const optionalStrings = [
		state.worktreeGitDir,
		state.isolatedSessionFile,
		state.driverToken,
		state.cleanupBranchHead,
		state.rebasedHead,
		state.expectedParentHead,
		state.integratedHead,
		state.lastError,
	];
	return state.version === 1
		&& requiredStrings.every((field) => typeof field === "string" && field.length > 0)
		&& optionalStrings.every((field) => field === undefined || typeof field === "string")
		&& typeof state.phase === "string"
		&& ISOLATION_PHASES.has(state.phase)
		&& (state.exitMode === undefined || state.exitMode === "finish" || state.exitMode === "discard");
}
