import path from "node:path";

export interface ProjectMemoryConfig {
	projectRoot: string;
	projectName: string;
	projectWing: string;
	memoryRoot: string;
	palaceRoot: string;
	ingestRoot: string;
	statePath: string;
}

function sanitizeWingSegment(value: string): string {
	const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
	return sanitized || "project";
}

export function deriveProjectMemoryConfig(cwd: string): ProjectMemoryConfig {
	const projectRoot = path.resolve(cwd);
	const projectName = path.basename(projectRoot);
	const memoryRoot = path.join(projectRoot, ".pi", "memory", "mempalace");

	return {
		projectRoot,
		projectName,
		projectWing: `wing_${sanitizeWingSegment(projectName)}`,
		memoryRoot,
		palaceRoot: path.join(memoryRoot, "palace"),
		ingestRoot: path.join(memoryRoot, "ingest", "pi-session"),
		statePath: path.join(memoryRoot, "state.json"),
	};
}
