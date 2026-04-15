export interface SessionBranchEntry {
	type: string;
	id: string;
	parentId: string | null;
	timestamp: string;
	message?: Record<string, unknown>;
	customType?: string;
	data?: unknown;
}

export interface SyncChunkMessage {
	role: "user" | "assistant" | "toolResult";
	text: string;
	toolName?: string;
}

export interface SyncChunk {
	source: "pi-session";
	sessionFile: string | null;
	entryStartId: string;
	entryEndId: string;
	projectRoot: string;
	projectWing: string;
	createdAt: string;
	messages: SyncChunkMessage[];
	metadata: {
		filesTouched: string[];
		gitBranch: string | null;
	};
}

interface BuildSyncChunkOptions {
	branchEntries: SessionBranchEntry[];
	projectRoot: string;
	projectWing: string;
	sessionFile: string | null;
	lastSyncedEntryId?: string;
	now: string;
	gitBranch?: string | null;
}

interface TextContent {
	type: string;
	text?: string;
}

const PATH_PATTERN = /(?:^|\s)([A-Za-z0-9_./-]+\.[A-Za-z0-9]+)(?=$|\s)/g;
const QUOTED_PATH_PATTERN = /[`"']([A-Za-z0-9_./-]+)[`"']/g;
const SPECIAL_FILENAMES = new Set(["README", "Makefile", "Dockerfile", "Procfile", "Gemfile"]);

function getUnsyncedEntries(entries: SessionBranchEntry[], lastSyncedEntryId?: string): SessionBranchEntry[] {
	if (!lastSyncedEntryId) return entries;
	const lastIndex = entries.findIndex((entry) => entry.id === lastSyncedEntryId);
	if (lastIndex === -1) return entries;
	return entries.slice(lastIndex + 1);
}

function readTextContent(content: unknown): string | null {
	if (typeof content === "string") return content.trim() || null;
	if (!Array.isArray(content)) return null;

	const text = content
		.filter((part): part is TextContent => Boolean(part) && typeof part === "object" && (part as TextContent).type === "text")
		.map((part) => part.text?.trim() ?? "")
		.filter(Boolean)
		.join("\n\n");

	return text || null;
}

function maybeAddFile(files: Set<string>, value: string | undefined) {
	const normalized = value?.trim().replace(/^[`"']+|[`"'),.:;]+$/g, "");
	if (!normalized) return;
	if (normalized.includes("/") || normalized.includes(".") || SPECIAL_FILENAMES.has(normalized)) {
		files.add(normalized);
	}
}

function extractFiles(text: string): string[] {
	const files = new Set<string>();
	for (const match of text.matchAll(PATH_PATTERN)) {
		maybeAddFile(files, match[1]);
	}
	for (const match of text.matchAll(QUOTED_PATH_PATTERN)) {
		maybeAddFile(files, match[1]);
	}
	return [...files];
}

function normalizeMessage(entry: SessionBranchEntry): SyncChunkMessage | null {
	if (entry.type !== "message" || !entry.message) return null;

	const role = entry.message.role;
	if (role === "user") {
		const text = readTextContent(entry.message.content);
		return text ? { role: "user", text } : null;
	}

	if (role === "assistant") {
		const text = readTextContent(entry.message.content);
		return text ? { role: "assistant", text } : null;
	}

	if (role === "toolResult") {
		const text = readTextContent(entry.message.content);
		const toolName = typeof entry.message.toolName === "string" ? entry.message.toolName : undefined;
		return text ? { role: "toolResult", toolName, text } : null;
	}

	return null;
}

export function buildSyncChunk(options: BuildSyncChunkOptions): SyncChunk | null {
	const unsyncedEntries = getUnsyncedEntries(options.branchEntries, options.lastSyncedEntryId);
	const messages = unsyncedEntries.map(normalizeMessage).filter((message): message is SyncChunkMessage => message !== null);
	if (messages.length === 0) return null;

	const firstEntry = unsyncedEntries.find((entry) => normalizeMessage(entry) !== null);
	const lastEntry = [...unsyncedEntries].reverse().find((entry) => normalizeMessage(entry) !== null);
	if (!firstEntry || !lastEntry) return null;

	const filesTouched = new Set<string>();
	for (const message of messages) {
		for (const file of extractFiles(message.text)) filesTouched.add(file);
	}

	return {
		source: "pi-session",
		sessionFile: options.sessionFile,
		entryStartId: firstEntry.id,
		entryEndId: lastEntry.id,
		projectRoot: options.projectRoot,
		projectWing: options.projectWing,
		createdAt: options.now,
		messages,
		metadata: {
			filesTouched: [...filesTouched],
			gitBranch: options.gitBranch ?? null,
		},
	};
}
