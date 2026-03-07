import { readFile, writeFile, copyFile, access, constants, readdir, stat, mkdir } from "node:fs/promises";
import path from "node:path";

export async function ensureGitignoreEntry(repoRoot: string): Promise<boolean> {
	const gitignorePath = path.join(repoRoot, ".gitignore");
	const entry = ".worktrees/";

	let content = "";
	try {
		content = await readFile(gitignorePath, "utf-8");
	} catch {
	}

	const lines = content.split("\n");
	const alreadyPresent = lines.some((line) => line.trim() === entry || line.trim() === ".worktrees");
	if (alreadyPresent) return false;

	const separator = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
	const newContent = `${content}${separator}${entry}\n`;
	await writeFile(gitignorePath, newContent, "utf-8");
	return true;
}

export async function copyEnvFiles(repoRoot: string, worktreePath: string): Promise<string[]> {
	const copied: string[] = [];

	try {
		const entries = await readdir(repoRoot);
		for (const entry of entries) {
			if (!entry.startsWith(".env")) continue;

			const fullPath = path.join(repoRoot, entry);
			const fileStat = await stat(fullPath);
			if (!fileStat.isFile()) continue;

			const destPath = path.join(worktreePath, entry);
			await copyFile(fullPath, destPath);
			copied.push(entry);
		}
	} catch {
	}

	return copied;
}

export async function copyConfigFiles(repoRoot: string, worktreePath: string, files: string[]): Promise<string[]> {
	const copied: string[] = [];

	for (const file of files) {
		const srcPath = path.resolve(repoRoot, file);
		const relativePath = path.relative(repoRoot, srcPath);
		if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) continue;

		try {
			await access(srcPath, constants.F_OK);
			const fileStat = await stat(srcPath);
			if (!fileStat.isFile()) continue;

			const destPath = path.join(worktreePath, relativePath);
			const destDir = path.dirname(destPath);
			await mkdir(destDir, { recursive: true });

			await copyFile(srcPath, destPath);
			copied.push(relativePath);
		} catch {
		}
	}

	return copied;
}

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
					.filter((f) => !f.includes("/"))
					.filter((f) => !f.startsWith(".env"))
					.filter((f) => !f.endsWith(".db") && !f.endsWith(".sqlite") && !f.endsWith(".log"))
					.filter((f) => f !== ".DS_Store");

				resolve(files);
			},
		);
	});
}

export async function copyAllConfigFiles(
	repoRoot: string,
	worktreePath: string,
	extraFiles?: string[],
): Promise<string[]> {
	const envCopied = await copyEnvFiles(repoRoot, worktreePath);

	const ignoredFiles = await findGitignoredFiles(repoRoot);
	const ignoredCopied = await copyConfigFiles(repoRoot, worktreePath, ignoredFiles);

	const extraCopied = extraFiles ? await copyConfigFiles(repoRoot, worktreePath, extraFiles) : [];

	const allCopied = [...new Set([...envCopied, ...ignoredCopied, ...extraCopied])];
	return allCopied;
}
