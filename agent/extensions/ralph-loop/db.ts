import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATION_VERSION = 1;
const connections = new Map<string, DatabaseSync>();

function applyPragmas(db: DatabaseSync): void {
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA journal_mode = WAL");
}

function migrate(db: DatabaseSync, schemaSql: string): void {
	const row = db.prepare("PRAGMA user_version").get() as { user_version?: number };
	const current = row?.user_version ?? 0;
	if (current >= MIGRATION_VERSION) return;

	db.exec("BEGIN");
	try {
		db.exec(schemaSql);
		db.exec(`PRAGMA user_version = ${MIGRATION_VERSION}`);
		db.exec("COMMIT");
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}

export function getRalphDb(dbPath: string): DatabaseSync {
	const normalized = dbPath.trim();
	const cached = connections.get(normalized);
	if (cached) return cached;

	mkdirSync(dirname(normalized), { recursive: true });
	const db = new DatabaseSync(normalized);
	applyPragmas(db);
	const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
	migrate(db, readFileSync(schemaPath, "utf8"));
	connections.set(normalized, db);
	return db;
}

export function closeAllRalphDbs(): void {
	for (const db of connections.values()) {
		try {
			db.close();
		} catch {
		}
	}
	connections.clear();
}
