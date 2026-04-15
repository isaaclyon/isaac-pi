import { deriveProjectMemoryConfig } from "./config.js";
import { createHelperRunner } from "./helpers.js";
import { buildSyncChunk, type SessionBranchEntry } from "./normalize.js";

interface OperationContext {
	cwd: string;
	sessionManager?: {
		getBranch?: () => SessionBranchEntry[];
		getSessionFile?: () => string | null;
	};
}

interface ToolResult {
	content: Array<{ type: "text"; text: string }>;
	details?: Record<string, unknown>;
	isError?: boolean;
}

interface StatusResponse {
	ok: boolean;
	mempalaceAvailable: boolean;
	projectWing: string;
	memoryRoot: string;
	palaceRoot: string;
	bootstrapped?: boolean;
	lastSync: { sessionFile?: string | null; entryId?: string | null; timestamp?: string | null } | null;
	stats: {
		ingestFiles: number;
		indexedItems: number;
	};
	error?: string;
}

interface SearchResponse {
	ok: boolean;
	query?: string;
	bootstrapped?: boolean;
	summaryText?: string;
	rawOutput?: string;
	error?: string;
	code?: string;
}

interface SyncResponse {
	ok: boolean;
	saved?: boolean;
	bootstrapped?: boolean;
	indexedCount?: number;
	chunkPath?: string;
	lastSync?: { sessionFile?: string | null; entryId?: string | null; timestamp?: string | null } | null;
	rawOutput?: string;
	error?: string;
	code?: string;
}

type HelperAction = "status" | "sync" | "search";
type HelperRunner = <TPayload extends object, TResult>(action: HelperAction, payload: TPayload) => Promise<TResult>;

interface OperationsDeps {
	runHelper?: HelperRunner;
	now?: () => string;
}

function textResult(text: string, details?: Record<string, unknown>, isError = false): ToolResult {
	return {
		content: [{ type: "text", text }],
		details,
		isError,
	};
}

function formatStatus(result: StatusResponse) {
	return [
		`Project memory: ${result.projectWing}`,
		`Memory root: ${result.memoryRoot}`,
		`Palace root: ${result.palaceRoot}`,
		`MemPalace CLI: ${result.mempalaceAvailable ? "available" : "unavailable"}`,
		`Indexed items: ${result.stats.indexedItems}`,
		`Ingest files: ${result.stats.ingestFiles}`,
		`Last sync: ${result.lastSync?.timestamp ?? "never"}`,
	].join("\n");
}

export function createMempalaceOperations(deps: OperationsDeps = {}) {
	const runHelper = deps.runHelper ?? createHelperRunner();
	const now = deps.now ?? (() => new Date().toISOString());

	return {
		async getStatus(ctx: OperationContext): Promise<ToolResult> {
			const config = deriveProjectMemoryConfig(ctx.cwd);
			const status = await runHelper<typeof config, StatusResponse>("status", config);
			if (!status.ok) {
				return textResult(status.error ?? "Failed to load project memory status.", { status }, true);
			}
			return textResult(formatStatus(status), {
				status,
				mempalace: {
					action: "status",
					bootstrapped: status.bootstrapped === true,
				},
			});
		},

		async search(ctx: OperationContext, query: string): Promise<ToolResult> {
			const trimmed = query.trim();
			if (!trimmed) return textResult("Search query is required.", undefined, true);

			const config = deriveProjectMemoryConfig(ctx.cwd);
			const result = await runHelper<object, SearchResponse>("search", { ...config, query: trimmed });
			if (!result.ok) {
				return textResult(result.error ?? "Project memory search failed.", { result }, true);
			}
			return textResult(result.summaryText ?? result.rawOutput ?? "No matching memory found.", {
				result,
				mempalace: {
					action: "search",
					bootstrapped: result.bootstrapped === true,
					query: trimmed,
				},
			});
		},

		async sync(ctx: OperationContext): Promise<ToolResult> {
			const branchEntries = ctx.sessionManager?.getBranch?.();
			if (!branchEntries) {
				return textResult("Current session does not expose branch history for memory sync.", undefined, true);
			}

			const config = deriveProjectMemoryConfig(ctx.cwd);
			const status = await runHelper<typeof config, StatusResponse>("status", config);
			if (!status.ok) {
				return textResult(status.error ?? "Failed to load project memory status.", { status }, true);
			}

			const sessionFile = ctx.sessionManager?.getSessionFile?.() ?? null;
			const lastSyncedEntryId = status.lastSync?.sessionFile === sessionFile ? status.lastSync.entryId ?? undefined : undefined;
			const chunk = buildSyncChunk({
				branchEntries,
				projectRoot: config.projectRoot,
				projectWing: config.projectWing,
				sessionFile,
				lastSyncedEntryId,
				now: now(),
			});

			if (!chunk) {
				return textResult("No new branch content to sync into project memory.");
			}

			const result = await runHelper<object, SyncResponse>("sync", { ...config, chunk });
			if (!result.ok) {
				return textResult(result.error ?? "Project memory sync failed.", { result }, true);
			}

			return textResult(
				[
					`Synced ${chunk.messages.length} memory messages to ${config.projectWing}.`,
					result.chunkPath ? `Chunk: ${result.chunkPath}` : undefined,
					result.rawOutput?.trim() || undefined,
				].filter(Boolean).join("\n"),
				{
					result,
					chunk,
					mempalace: {
						action: "sync",
						bootstrapped: result.bootstrapped === true,
						messageCount: chunk.messages.length,
					},
				},
			);
		},
	};
}
