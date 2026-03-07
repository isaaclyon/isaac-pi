import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { closeAllLcmDbs, getLcmDb } from "./db.ts";

function run() {
	const tempDir = mkdtempSync(join(tmpdir(), "pi-lcm-smoke-"));
	const dbPath = join(tempDir, "lcm.sqlite");

	try {
		const db = getLcmDb(dbPath);
		const dbSecond = getLcmDb(dbPath);
		assert.equal(db, dbSecond, "expected getLcmDb to return cached connection for same path");

		const tables = db
			.prepare(
				`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
					'conversations',
					'messages',
					'summaries',
					'summary_messages',
					'summary_parents',
					'context_items'
				)`
			)
			.all()
			.map((row) => String(row.name))
			.sort();

		assert.deepEqual(tables, [
			"context_items",
			"conversations",
			"messages",
			"summaries",
			"summary_messages",
			"summary_parents",
		]);

		const indexRows = db
			.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_messages_conversation_seq'`)
			.all();
		assert.equal(indexRows.length, 1, "expected message sequence index");

		const userVersion = db.prepare("PRAGMA user_version").get();
		assert.equal(Number(userVersion.user_version), 1, "expected schema migration user_version=1");

		const journalMode = db.prepare("PRAGMA journal_mode").get();
		assert.equal(String(journalMode.journal_mode).toLowerCase(), "wal", "expected WAL journal mode");

		console.log("LCM smoke test passed");
	} finally {
		closeAllLcmDbs();
		rmSync(tempDir, { recursive: true, force: true });
	}
}

run();
