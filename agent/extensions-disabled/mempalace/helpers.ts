import { spawn as nodeSpawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

type HelperAction = "status" | "sync" | "search";

type SpawnResult = {
	code: number | null;
	stdout: string;
	stderr: string;
};

type SpawnFn = (command: string, args: string[], stdin: string) => Promise<SpawnResult>;

interface HelperRunnerDeps {
	spawn?: SpawnFn;
}

const HELPERS_DIR = fileURLToPath(new URL("./helpers/", import.meta.url));

async function spawnProcess(command: string, args: string[], stdin: string): Promise<SpawnResult> {
	return new Promise((resolve, reject) => {
		const child = nodeSpawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		let stdout = "";
		let stderr = "";

		child.stdout.on("data", (chunk) => {
			stdout += chunk.toString();
		});
		child.stderr.on("data", (chunk) => {
			stderr += chunk.toString();
		});
		child.on("error", reject);
		child.on("close", (code) => resolve({ code, stdout, stderr }));
		child.stdin.end(stdin);
	});
}

export function createHelperRunner(deps: HelperRunnerDeps = {}) {
	const spawn = deps.spawn ?? spawnProcess;

	return async function runHelper<TPayload extends object, TResult>(action: HelperAction, payload: TPayload): Promise<TResult> {
		const helperPath = path.join(HELPERS_DIR, `${action}.py`);
		const stdin = JSON.stringify(payload);
		const result = await spawn("uv", ["run", helperPath], stdin);

		if (result.code !== 0) {
			const detail = result.stderr.trim() || result.stdout.trim() || "unknown error";
			throw new Error(`MemPalace helper '${action}' failed with exit code ${result.code}: ${detail}`);
		}

		try {
			return JSON.parse(result.stdout) as TResult;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`MemPalace helper '${action}' returned invalid JSON: ${message}`);
		}
	};
}
