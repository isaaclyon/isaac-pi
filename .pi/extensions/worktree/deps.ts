import { access, constants } from "node:fs/promises";
import path from "node:path";
import { runGit } from "./git";
import { makeToolError } from "./results";
import type { PackageManager, PackageManagerMatch, ToolError } from "./types";

/**
 * Priority-ordered list of package managers and their lockfiles.
 * First match wins.
 */
const PACKAGE_MANAGERS: Array<{ manager: PackageManager; lockfile: string; command: string[] }> = [
	{ manager: "pnpm", lockfile: "pnpm-lock.yaml", command: ["pnpm", "install", "--frozen-lockfile"] },
	{ manager: "npm", lockfile: "package-lock.json", command: ["npm", "ci"] },
	{ manager: "yarn", lockfile: "yarn.lock", command: ["yarn", "install", "--frozen-lockfile"] },
	{ manager: "bun", lockfile: "bun.lockb", command: ["bun", "install", "--frozen-lockfile"] },
	{ manager: "uv", lockfile: "uv.lock", command: ["uv", "sync"] },
	{ manager: "pip", lockfile: "requirements.txt", command: ["pip", "install", "-r", "requirements.txt"] },
];

async function fileExists(filePath: string): Promise<boolean> {
	try {
		await access(filePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * Detect the package manager by checking for lockfiles in priority order.
 * Returns the first match, or undefined if none found.
 */
export async function detectPackageManager(repoRoot: string): Promise<PackageManagerMatch | undefined> {
	for (const pm of PACKAGE_MANAGERS) {
		const lockfilePath = path.join(repoRoot, pm.lockfile);
		if (await fileExists(lockfilePath)) {
			return {
				manager: pm.manager,
				lockfile: pm.lockfile,
				installCommand: pm.command,
			};
		}
	}
	return undefined;
}

/**
 * Run the dep install command in the given worktree directory.
 * Uses `git` exec helper pattern but spawns the actual package manager.
 */
export async function installDeps(worktreePath: string, pm: PackageManagerMatch): Promise<true | ToolError> {
	const [command, ...args] = pm.installCommand;
	if (!command) {
		return makeToolError("Empty install command", "DEP_INSTALL_FAILED");
	}

	// Use runGit's underlying pattern but for arbitrary commands
	const { execFile } = await import("node:child_process");

	return new Promise((resolve) => {
		const child = execFile(
			command,
			args,
			{ cwd: worktreePath, maxBuffer: 10 * 1024 * 1024, timeout: 300_000 },
			(error, _stdout, stderr) => {
				if (error) {
					resolve(makeToolError(`${pm.manager} install failed: ${stderr ?? error.message}`, "DEP_INSTALL_FAILED"));
					return;
				}
				resolve(true);
			},
		);

		child.on("error", (err: NodeJS.ErrnoException) => {
			if (err.code === "ENOENT") {
				resolve(makeToolError(`${pm.manager} is not installed or not available in PATH`, "DEP_INSTALL_FAILED"));
				return;
			}
			resolve(makeToolError(`${pm.manager} install failed: ${err.message}`, "DEP_INSTALL_FAILED"));
		});
	});
}
