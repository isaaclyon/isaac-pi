import type { DatabaseSync } from "node:sqlite";
import type {
	RalphCheckpointInput,
	RalphEventInput,
	RalphLoopRecord,
	RalphRunConfig,
	RalphRunRecord,
	RalphRunState,
} from "./types.js";

export class RalphStore {
	private readonly db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	createRun(input: {
		runId: string;
		task: string;
		maxLoops: number;
		state?: RalphRunState;
		config: RalphRunConfig;
		createdAt: number;
	}): RalphRunRecord {
		const state = input.state ?? "running";
		this.db
			.prepare(
				`INSERT INTO runs (run_id, state, task, max_loops, active_loop, config_json, created_at, updated_at)
				 VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
			)
			.run(
				input.runId,
				state,
				input.task,
				input.maxLoops,
				JSON.stringify(input.config),
				input.createdAt,
				input.createdAt,
			);

		const run = this.getRun(input.runId);
		if (!run) {
			throw new Error(`Run not found after create: ${input.runId}`);
		}
		return run;
	}

	getRun(runId: string): RalphRunRecord | undefined {
		const row = this.db
			.prepare(
				`SELECT run_id, state, task, max_loops, active_loop, config_json, created_at, updated_at
				 FROM runs
				 WHERE run_id = ?`,
			)
			.get(runId) as
			| {
					run_id: string;
					state: RalphRunState;
					task: string;
					max_loops: number;
					active_loop: number;
					config_json: string;
					created_at: number;
					updated_at: number;
			  }
			| undefined;
		if (!row) return undefined;

		return {
			runId: row.run_id,
			state: row.state,
			task: row.task,
			maxLoops: row.max_loops,
			activeLoop: row.active_loop,
			configJson: row.config_json,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		};
	}

	listRuns(limit = 20): RalphRunRecord[] {
		const rows = this.db
			.prepare(
				`SELECT run_id, state, task, max_loops, active_loop, config_json, created_at, updated_at
				 FROM runs
				 ORDER BY created_at DESC
				 LIMIT ?`,
			)
			.all(limit) as Array<{
				run_id: string;
				state: RalphRunState;
				task: string;
				max_loops: number;
				active_loop: number;
				config_json: string;
				created_at: number;
				updated_at: number;
			}>;
		return rows.map((row) => ({
			runId: row.run_id,
			state: row.state,
			task: row.task,
			maxLoops: row.max_loops,
			activeLoop: row.active_loop,
			configJson: row.config_json,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}));
	}

	updateRunState(runId: string, state: RalphRunState, updatedAt: number): void {
		this.db.prepare("UPDATE runs SET state = ?, updated_at = ? WHERE run_id = ?").run(state, updatedAt, runId);
	}

	setActiveLoop(runId: string, activeLoop: number, updatedAt: number): void {
		this.db.prepare("UPDATE runs SET active_loop = ?, updated_at = ? WHERE run_id = ?").run(activeLoop, updatedAt, runId);
	}

	startLoop(input: { runId: string; loopNumber: number; startedAt: number }): RalphLoopRecord {
		this.db
			.prepare(
				`INSERT INTO loops (run_id, loop_number, state, trigger_reason, started_at, ended_at, summary, checkpoint_json)
				 VALUES (?, ?, 'running', NULL, ?, NULL, NULL, NULL)`,
			)
			.run(input.runId, input.loopNumber, input.startedAt);
		this.setActiveLoop(input.runId, input.loopNumber, input.startedAt);

		const loop = this.getLoop(input.runId, input.loopNumber);
		if (!loop) {
			throw new Error(`Loop missing after start: ${input.runId}#${input.loopNumber}`);
		}
		return loop;
	}

	getLoop(runId: string, loopNumber: number): RalphLoopRecord | undefined {
		const row = this.db
			.prepare(
				`SELECT loop_id, run_id, loop_number, state, trigger_reason, started_at, ended_at, summary, checkpoint_json
				 FROM loops
				 WHERE run_id = ? AND loop_number = ?`,
			)
			.get(runId, loopNumber) as
			| {
					loop_id: number;
					run_id: string;
					loop_number: number;
					state: "running" | "completed" | "failed" | "stopped";
					trigger_reason: string | null;
					started_at: number;
					ended_at: number | null;
					summary: string | null;
					checkpoint_json: string | null;
			  }
			| undefined;
		if (!row) return undefined;
		return {
			loopId: row.loop_id,
			runId: row.run_id,
			loopNumber: row.loop_number,
			state: row.state,
			triggerReason: row.trigger_reason,
			startedAt: row.started_at,
			endedAt: row.ended_at,
			summary: row.summary,
			checkpointJson: row.checkpoint_json,
		};
	}

	completeLoop(input: {
		runId: string;
		loopNumber: number;
		state: "completed" | "failed" | "stopped";
		triggerReason: string;
		summary: string;
		checkpointJson: string;
		endedAt: number;
	}): void {
		this.db
			.prepare(
				`UPDATE loops
				 SET state = ?, trigger_reason = ?, summary = ?, checkpoint_json = ?, ended_at = ?
				 WHERE run_id = ? AND loop_number = ?`,
			)
			.run(
				input.state,
				input.triggerReason,
				input.summary,
				input.checkpointJson,
				input.endedAt,
				input.runId,
				input.loopNumber,
			);
	}

	saveCheckpoint(input: RalphCheckpointInput): void {
		this.db
			.prepare(
				`INSERT INTO checkpoints (run_id, loop_number, trigger_reason, summary, artifacts_json, next_prompt, created_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(run_id, loop_number)
				 DO UPDATE SET
					trigger_reason = excluded.trigger_reason,
					summary = excluded.summary,
					artifacts_json = excluded.artifacts_json,
					next_prompt = excluded.next_prompt,
					created_at = excluded.created_at`,
			)
			.run(
				input.runId,
				input.loopNumber,
				input.triggerReason,
				input.summary,
				input.artifactsJson,
				input.nextPrompt,
				input.createdAt,
			);
	}

	appendEvent(input: RalphEventInput): void {
		this.db
			.prepare(
				`INSERT INTO events (run_id, loop_id, event_type, payload_json, created_at)
				 VALUES (?, ?, ?, ?, ?)`,
			)
			.run(input.runId, input.loopId ?? null, input.eventType, input.payloadJson, input.createdAt);
	}
}
