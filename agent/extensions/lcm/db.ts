import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

const connectionCache = new Map<string, DatabaseSync>();

// Each entry applies exactly the SQL delta for that version.
// To add a new migration: append a new object — never edit existing entries.
const MIGRATIONS: Array<{ version: number; sql: string }> = [
	{
		// v1 — initial schema: all tables + basic indexes
		version: 1,
		sql: `
			CREATE TABLE IF NOT EXISTS conversations (
				conversation_id INTEGER PRIMARY KEY AUTOINCREMENT,
				conversation_key TEXT NOT NULL UNIQUE,
				session_file TEXT,
				cwd TEXT NOT NULL,
				created_at INTEGER NOT NULL,
				updated_at INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS messages (
				message_id INTEGER PRIMARY KEY AUTOINCREMENT,
				conversation_id INTEGER NOT NULL,
				seq INTEGER NOT NULL,
				entry_id TEXT,
				role TEXT NOT NULL,
				content_text TEXT NOT NULL,
				content_json TEXT,
				token_estimate INTEGER NOT NULL,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
				ON messages(conversation_id, seq);
			CREATE TABLE IF NOT EXISTS summaries (
				summary_row_id INTEGER PRIMARY KEY AUTOINCREMENT,
				summary_id TEXT NOT NULL UNIQUE,
				conversation_id INTEGER NOT NULL,
				depth INTEGER NOT NULL,
				kind TEXT NOT NULL,
				content TEXT NOT NULL,
				token_estimate INTEGER NOT NULL,
				earliest_at INTEGER,
				latest_at INTEGER,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE
			);
			CREATE INDEX IF NOT EXISTS idx_summaries_conversation_depth
				ON summaries(conversation_id, depth, created_at);
			CREATE TABLE IF NOT EXISTS summary_messages (
				summary_id TEXT NOT NULL,
				message_id INTEGER NOT NULL,
				ordinal INTEGER NOT NULL,
				PRIMARY KEY (summary_id, message_id),
				FOREIGN KEY (summary_id) REFERENCES summaries(summary_id) ON DELETE CASCADE,
				FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE
			);
			CREATE TABLE IF NOT EXISTS summary_parents (
				summary_id TEXT NOT NULL,
				parent_summary_id TEXT NOT NULL,
				ordinal INTEGER NOT NULL,
				PRIMARY KEY (summary_id, parent_summary_id),
				FOREIGN KEY (summary_id) REFERENCES summaries(summary_id) ON DELETE CASCADE,
				FOREIGN KEY (parent_summary_id) REFERENCES summaries(summary_id) ON DELETE CASCADE
			);
			CREATE TABLE IF NOT EXISTS context_items (
				context_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
				conversation_id INTEGER NOT NULL,
				ordinal INTEGER NOT NULL,
				item_type TEXT NOT NULL,
				message_id INTEGER,
				summary_id TEXT,
				created_at INTEGER NOT NULL,
				FOREIGN KEY (conversation_id) REFERENCES conversations(conversation_id) ON DELETE CASCADE,
				FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
				FOREIGN KEY (summary_id) REFERENCES summaries(summary_id) ON DELETE CASCADE,
				CHECK (
					(item_type = 'message' AND message_id IS NOT NULL AND summary_id IS NULL)
					OR
					(item_type = 'summary' AND summary_id IS NOT NULL AND message_id IS NULL)
				)
			);
			CREATE INDEX IF NOT EXISTS idx_context_items_conversation_ordinal
				ON context_items(conversation_id, ordinal);
		`,
	},
	{
		// v2 — partial unique index: deduplicate messages with a non-NULL entry_id.
		//      NULL entry_id rows remain unrestricted (one per bootstrapped message).
		version: 2,
		sql: `
			CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_unique_entry
				ON messages(conversation_id, entry_id) WHERE entry_id IS NOT NULL;
		`,
	},
];

function configureConnection(db: DatabaseSync): void {
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA journal_mode = WAL");
}

function applyMigrations(db: DatabaseSync): void {
	const versionRow = db.prepare("PRAGMA user_version").get() as { user_version?: number };
	const currentVersion = versionRow?.user_version ?? 0;
	const pending = MIGRATIONS.filter((m) => m.version > currentVersion);
	if (pending.length === 0) {
		return;
	}

	db.exec("BEGIN");
	try {
		for (const migration of pending) {
			db.exec(migration.sql);
			db.exec(`PRAGMA user_version = ${migration.version}`);
		}
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

export function getLcmDb(dbPath: string): DatabaseSync {
	const normalizedPath = dbPath.trim();
	const cached = connectionCache.get(normalizedPath);
	if (cached) {
		return cached;
	}

	mkdirSync(dirname(normalizedPath), { recursive: true });
	const db = new DatabaseSync(normalizedPath);
	configureConnection(db);
	applyMigrations(db);

	connectionCache.set(normalizedPath, db);
	return db;
}

export function closeAllLcmDbs(): void {
	for (const db of connectionCache.values()) {
		try {
			db.close();
		} catch {
			// ignore close errors during shutdown.
		}
	}
	connectionCache.clear();
}
