CREATE TABLE IF NOT EXISTS runs (
	run_id TEXT PRIMARY KEY,
	state TEXT NOT NULL,
	task TEXT NOT NULL,
	max_loops INTEGER NOT NULL,
	active_loop INTEGER NOT NULL DEFAULT 0,
	config_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS loops (
	loop_id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id TEXT NOT NULL,
	loop_number INTEGER NOT NULL,
	state TEXT NOT NULL,
	trigger_reason TEXT,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	summary TEXT,
	checkpoint_json TEXT,
	UNIQUE(run_id, loop_number),
	FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkpoints (
	checkpoint_id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id TEXT NOT NULL,
	loop_number INTEGER NOT NULL,
	trigger_reason TEXT NOT NULL,
	summary TEXT NOT NULL,
	artifacts_json TEXT NOT NULL,
	next_prompt TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	UNIQUE(run_id, loop_number),
	FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
	event_id INTEGER PRIMARY KEY AUTOINCREMENT,
	run_id TEXT NOT NULL,
	loop_id INTEGER,
	event_type TEXT NOT NULL,
	payload_json TEXT NOT NULL,
	created_at INTEGER NOT NULL,
	FOREIGN KEY(run_id) REFERENCES runs(run_id) ON DELETE CASCADE,
	FOREIGN KEY(loop_id) REFERENCES loops(loop_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runs_state ON runs(state);
CREATE INDEX IF NOT EXISTS idx_loops_run_id ON loops(run_id);
CREATE INDEX IF NOT EXISTS idx_events_run_id ON events(run_id);
CREATE INDEX IF NOT EXISTS idx_checkpoints_run_id ON checkpoints(run_id);
