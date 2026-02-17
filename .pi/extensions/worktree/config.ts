import { readFile, writeFile, copyFile, access, constants, readdir, stat } from "node:fs/promises";
import path from "node:path";

/**
 * Ensure `.worktrees/` is in .gitignore. Returns true if .gitignore was modified.
 */
export async function ensureGitignoreEntry(repoRoot: string): Promise<boolean> {
	const gitignorePath = path.join(repoRoot, ".gitignore");
	const entry = ".worktrees/";

	let content = "";
	try {
		content = await readFile(gitignorePath, "utf-8");
	} catch {
		// .gitignore doesn't exist yet — we'll create it
	}

	// Check if the entry already exists (exact line match)
	const lines = content.split("\n");
	const alreadyPresent = lines.some((line) => line.trim() === entry || line.trim() === ".worktrees");
	if (alreadyPresent) return false;

	// Append the entry
	const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
	const newContent = `${content}${separator}${entry}\n`;
	await writeFile(gitignorePath, newContent, "utf-8");
	return true;
}

/**
 * Copy .env* files from repo root to the worktree.
 * Returns the list of files copied (relative names).
 */
export async function copyEnvFiles(repoRoot: string, worktreePath: string): Promise<string[]> {
	const copied: string[] = [];

	try {
		const entries = await readdir(repoRoot);
		for (const entry of entries) {
			if (!entry.startsWith(".env")) continue;

			// Make sure it's a file, not a directory
			const fullPath = path.join(repoRoot, entry);
			const fileStat = await stat(fullPath);
			if (!fileStat.isFile()) continue;

			const destPath = path.join(worktreePath, entry);
			await copyFile(fullPath, destPath);
			copied.push(entry);
		}
	} catch {
		// If readdir fails, just skip silently
	}

	return copied;
}

/**
 * Copy additional config files specified by the user.
 * Paths are resolved relative to the repo root.
 * Returns the list of files actually copied.
 */
export async function copyConfigFiles(repoRoot: string, worktreePath: string, files: string[]): Promise<string[]> {
	const copied: string[] = [];

	for (const file of files) {
		const srcPath = path.resolve(repoRoot, file);

		// Security: don't copy files outside the repo
		if (!srcPath.startsWith(repoRoot)) continue;

		try {
			await access(srcPath, constants.F_OK);
			const fileStat = await stat(srcPath);
			if (!fileStat.isFile()) continue;

			const destPath = path.join(worktreePath, file);

			// Create parent directories if needed
			const destDir = path.dirname(destPath);
			const { mkdir } = await import("node:fs/promises");
			await mkdir(destDir, { recursive: true });

			await copyFile(srcPath, destPath);
			copied.push(file);
		} catch {
			// File doesn't exist or can't be read — skip silently
		}
	}

	return copied;
}

/**
 * Find gitignored files that actually exist in the repo root.
 * Uses `git ls-files --others --ignored --exclude-standard` to find them.
 * Only returns root-level files (not nested) to keep scope manageable.
 */
export async function findGitignoredFiles(repoRoot: string): Promise<string[]> {
	const { execFile } = await import("node:child_process");

	return new Promise((resolve) => {
		execFile(
			"git",
			["ls-files", "--others", "--ignored", "--exclude-standard"],
			{ cwd: repoRoot, maxBuffer: 1024 * 1024 },
			(error, stdout) => {
				if (error || !stdout) {
					resolve([]);
					return;
				}

				const files = stdout
					.trim()
					.split("\n")
					.filter((f) => f.length > 0)
					// Only root-level files (no path separators)
					.filter((f) => !f.includes("/"))
					// Exclude .env* files (already handled separately)
					.filter((f) => !f.startsWith(".env"))
					// Exclude common large/binary files we don't want to copy
					.filter((f) => !f.endsWith(".db") && !f.endsWith(".sqlite") && !f.endsWith(".log"))
					// Exclude node_modules marker files or lockfiles
					.filter((f) => f !== ".DS_Store");

				resolve(files);
			},
		);
	});
}

/**
 * Copy all config files: .env* + gitignored root-level files + user-specified files.
 * Returns the combined list of files copied.
 */
export async function copyAllConfigFiles(
	repoRoot: string,
	worktreePath: string,
	extraFiles?: string[],
): Promise<string[]> {
	// 1. Copy .env* files
	const envCopied = await copyEnvFiles(repoRoot, worktreePath);

	// 2. Find and copy gitignored root-level files
	const ignoredFiles = await findGitignoredFiles(repoRoot);
	const ignoredCopied = await copyConfigFiles(repoRoot, worktreePath, ignoredFiles);

	// 3. Copy user-specified extra files
	const extraCopied = extraFiles ? await copyConfigFiles(repoRoot, worktreePath, extraFiles) : [];

	// Deduplicate
	const allCopied = [...new Set([...envCopied, ...ignoredCopied, ...extraCopied])];
	return allCopied;
}
