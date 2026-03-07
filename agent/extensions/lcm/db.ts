import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const MIGRATION_VERSION = 1;
const connectionCache = new Map<string, DatabaseSync>();

function configureConnection(db: DatabaseSync): void {
	db.exec("PRAGMA foreign_keys = ON");
	db.exec("PRAGMA synchronous = NORMAL");
	db.exec("PRAGMA journal_mode = WAL");
}

function applyMigrations(db: DatabaseSync, schemaSql: string): void {
	const versionRow = db.prepare("PRAGMA user_version").get() as { user_version?: number };
	const currentVersion = versionRow?.user_version ?? 0;
	if (currentVersion >= MIGRATION_VERSION) {
		return;
	}

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

export function getLcmDb(dbPath: string): DatabaseSync {
	const normalizedPath = dbPath.trim();
	const cached = connectionCache.get(normalizedPath);
	if (cached) {
		return cached;
	}

	mkdirSync(dirname(normalizedPath), { recursive: true });
	const db = new DatabaseSync(normalizedPath);
	configureConnection(db);
	const schemaPath = join(dirname(fileURLToPath(import.meta.url)), "schema.sql");
	const schemaSql = readFileSync(schemaPath, "utf8");
	applyMigrations(db, schemaSql);

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
