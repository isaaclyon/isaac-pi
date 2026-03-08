import type { DatabaseSync } from "node:sqlite";
import type {
	ContextItemRecord,
	ContextItemWrite,
	ConversationIdentity,
	ConversationRecord,
	MessageRecord,
	StoredMessage,
	SummaryKind,
} from "./types.ts";

type SummaryInsertInput = {
	summaryId: string;
	conversationId: number;
	depth: number;
	kind: SummaryKind;
	content: string;
	tokenEstimate: number;
	earliestAt: number | null;
	latestAt: number | null;
	createdAt: number;
};

export class LcmStore {
	private db: DatabaseSync;

	constructor(db: DatabaseSync) {
		this.db = db;
	}

	inTransaction<T>(run: () => T): T {
		this.db.exec("BEGIN");
		try {
			const result = run();
			this.db.exec("COMMIT");
			return result;
		} catch (error) {
			this.db.exec("ROLLBACK");
			throw error;
		}
	}

	getOrCreateConversation(identity: ConversationIdentity): ConversationRecord {
		const now = Date.now();
		this.db
			.prepare(
				`INSERT INTO conversations (conversation_key, session_file, cwd, created_at, updated_at)
				 VALUES (?, ?, ?, ?, ?)
				 ON CONFLICT(conversation_key) DO UPDATE SET
					session_file = excluded.session_file,
					updated_at = excluded.updated_at`
			)
			.run(identity.conversationKey, identity.sessionFile, identity.cwd, now, now);

		const row = this.db
			.prepare(
				`SELECT conversation_id, conversation_key, session_file, cwd
				 FROM conversations
				 WHERE conversation_key = ?`
			)
			.get(identity.conversationKey) as
			| {
					conversation_id: number;
					conversation_key: string;
					session_file: string | null;
					cwd: string;
			  }
			| undefined;

		if (!row) {
			throw new Error(`LCM conversation missing after upsert: ${identity.conversationKey}`);
		}

		return {
			conversationId: row.conversation_id,
			conversationKey: row.conversation_key,
			sessionFile: row.session_file,
			cwd: row.cwd,
		};
	}

	// Inner (un-transacted) insert — must be called inside an active transaction.
	private insertMessageInner(conversationId: number, message: StoredMessage): { inserted: boolean; messageId?: number } {
		const maxSeqRow = this.db
			.prepare("SELECT COALESCE(MAX(seq), 0) AS max_seq FROM messages WHERE conversation_id = ?")
			.get(conversationId) as { max_seq?: number };
		const seq = (maxSeqRow?.max_seq ?? 0) + 1;

		const result = this.db
			.prepare(
				`INSERT OR IGNORE INTO messages (
					conversation_id,
					seq,
					entry_id,
					role,
					content_text,
					content_json,
					token_estimate,
					created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
			)
			.run(
				conversationId,
				seq,
				message.entryId,
				message.role,
				message.contentText,
				message.contentJson,
				message.tokenEstimate,
				message.createdAt,
			);

		if ((result.changes ?? 0) === 0) {
			return { inserted: false };
		}

		const row = this.db
			.prepare("SELECT message_id FROM messages WHERE conversation_id = ? AND seq = ?")
			.get(conversationId, seq) as { message_id?: number } | undefined;

		if (!row?.message_id) {
			throw new Error(
				`LCM: message inserted (conversation_id=${conversationId} seq=${seq}) but post-insert lookup returned nothing`,
			);
		}

		this.appendMessageContextItem(conversationId, row.message_id, message.createdAt);
		return { inserted: true, messageId: row.message_id };
	}

	insertMessage(conversationId: number, message: StoredMessage): { inserted: boolean; messageId?: number } {
		return this.inTransaction(() => this.insertMessageInner(conversationId, message));
	}

	appendMessageContextItem(conversationId: number, messageId: number, createdAt: number): void {
		const maxOrdinalRow = this.db
			.prepare(
				"SELECT COALESCE(MAX(ordinal), -1) AS max_ordinal FROM context_items WHERE conversation_id = ?",
			)
			.get(conversationId) as { max_ordinal?: number };
		const ordinal = (maxOrdinalRow?.max_ordinal ?? -1) + 1;

		this.db
			.prepare(
				`INSERT INTO context_items (conversation_id, ordinal, item_type, message_id, summary_id, created_at)
				 VALUES (?, ?, 'message', ?, NULL, ?)`
			)
			.run(conversationId, ordinal, messageId, createdAt);
	}

	getMessageCount(conversationId: number): number {
		const row = this.db
			.prepare("SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?")
			.get(conversationId) as { count?: number };
		return row?.count ?? 0;
	}

	insertMessagesBatch(conversationId: number, messages: StoredMessage[]): number {
		if (messages.length === 0) {
			return 0;
		}

		return this.inTransaction(() => {
			let inserted = 0;
			for (const message of messages) {
				const result = this.insertMessageInner(conversationId, message);
				if (result.inserted) {
					inserted += 1;
				}
			}
			return inserted;
		});
	}

	listContextItems(conversationId: number): ContextItemRecord[] {
		return this.db
			.prepare(
				`SELECT
					ci.context_item_id,
					ci.ordinal,
					ci.item_type,
					ci.message_id,
					ci.summary_id,
					ci.created_at,
					CASE
						WHEN ci.item_type = 'message' THEN COALESCE(m.token_estimate, 0)
						ELSE COALESCE(s.token_estimate, 0)
					END AS token_estimate,
					s.depth AS summary_depth
				 FROM context_items ci
				 LEFT JOIN messages m ON m.message_id = ci.message_id
				 LEFT JOIN summaries s ON s.summary_id = ci.summary_id
				 WHERE ci.conversation_id = ?
				 ORDER BY ci.ordinal ASC`
			)
			.all(conversationId)
			.map((row) => ({
				contextItemId: Number(row.context_item_id),
				ordinal: Number(row.ordinal),
				itemType: String(row.item_type) as "message" | "summary",
				messageId: row.message_id === null ? null : Number(row.message_id),
				summaryId: row.summary_id === null ? null : String(row.summary_id),
				tokenEstimate: Number(row.token_estimate ?? 0),
				createdAt: Number(row.created_at),
				summaryDepth: row.summary_depth === null ? null : Number(row.summary_depth),
			}));
	}

	getContextTokenEstimate(conversationId: number): number {
		const row = this.db
			.prepare(
				`SELECT COALESCE(SUM(
					CASE
						WHEN ci.item_type = 'message' THEN COALESCE(m.token_estimate, 0)
						ELSE COALESCE(s.token_estimate, 0)
					END
				), 0) AS total
				FROM context_items ci
				LEFT JOIN messages m ON m.message_id = ci.message_id
				LEFT JOIN summaries s ON s.summary_id = ci.summary_id
				WHERE ci.conversation_id = ?`,
			)
			.get(conversationId) as { total?: number };
		return Number(row?.total ?? 0);
	}

	getMessagesByIds(messageIds: number[]): MessageRecord[] {
		if (messageIds.length === 0) {
			return [];
		}
		const placeholders = messageIds.map(() => "?").join(", ");
		const rows = this.db
			.prepare(
				`SELECT message_id, seq, role, content_text, content_json, token_estimate, created_at
				 FROM messages
				 WHERE message_id IN (${placeholders})
				 ORDER BY seq ASC`
			)
			.all(...messageIds);
		return rows.map((row) => ({
			messageId: Number(row.message_id),
			seq: Number(row.seq),
			role: String(row.role),
			contentText: String(row.content_text ?? ""),
			contentJson: row.content_json === null || row.content_json === undefined ? null : String(row.content_json),
			tokenEstimate: Number(row.token_estimate ?? 0),
			createdAt: Number(row.created_at),
		}));
	}

	getSummaryRows(summaryIds: string[]): Array<{ summaryId: string; depth: number; content: string; tokenEstimate: number; createdAt: number }> {
		if (summaryIds.length === 0) {
			return [];
		}
		const placeholders = summaryIds.map(() => "?").join(", ");
		const rows = this.db
			.prepare(
				`SELECT summary_id, depth, content, token_estimate, created_at
				 FROM summaries
				 WHERE summary_id IN (${placeholders})`
			)
			.all(...summaryIds);
		const map = new Map<string, { summaryId: string; depth: number; content: string; tokenEstimate: number; createdAt: number }>();
		for (const row of rows) {
			map.set(String(row.summary_id), {
				summaryId: String(row.summary_id),
				depth: Number(row.depth),
				content: String(row.content ?? ""),
				tokenEstimate: Number(row.token_estimate ?? 0),
				createdAt: Number(row.created_at),
			});
		}
		return summaryIds.map((id) => map.get(id)).filter((value): value is { summaryId: string; depth: number; content: string; tokenEstimate: number; createdAt: number } => Boolean(value));
	}

	upsertSummary(input: SummaryInsertInput): void {
		this.db
			.prepare(
				`INSERT INTO summaries (
					summary_id,
					conversation_id,
					depth,
					kind,
					content,
					token_estimate,
					earliest_at,
					latest_at,
					created_at
				) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(summary_id) DO UPDATE SET
					content = excluded.content,
					token_estimate = excluded.token_estimate,
					earliest_at = excluded.earliest_at,
					latest_at = excluded.latest_at,
					created_at = excluded.created_at`
			)
			.run(
				input.summaryId,
				input.conversationId,
				input.depth,
				input.kind,
				input.content,
				input.tokenEstimate,
				input.earliestAt,
				input.latestAt,
				input.createdAt,
			);
	}

	setSummaryMessages(summaryId: string, messageIds: number[]): void {
		this.db.prepare("DELETE FROM summary_messages WHERE summary_id = ?").run(summaryId);
		const stmt = this.db.prepare(
			`INSERT INTO summary_messages (summary_id, message_id, ordinal)
			 VALUES (?, ?, ?)`
		);
		for (let i = 0; i < messageIds.length; i += 1) {
			stmt.run(summaryId, messageIds[i], i);
		}
	}

	setSummaryParents(summaryId: string, parentSummaryIds: string[]): void {
		this.db.prepare("DELETE FROM summary_parents WHERE summary_id = ?").run(summaryId);
		const stmt = this.db.prepare(
			`INSERT INTO summary_parents (summary_id, parent_summary_id, ordinal)
			 VALUES (?, ?, ?)`
		);
		for (let i = 0; i < parentSummaryIds.length; i += 1) {
			stmt.run(summaryId, parentSummaryIds[i], i);
		}
	}

	setContextItems(conversationId: number, items: ContextItemWrite[]): void {
		this.db.prepare("DELETE FROM context_items WHERE conversation_id = ?").run(conversationId);
		const stmt = this.db.prepare(
			`INSERT INTO context_items (conversation_id, ordinal, item_type, message_id, summary_id, created_at)
			 VALUES (?, ?, ?, ?, ?, ?)`
		);
		for (let i = 0; i < items.length; i += 1) {
			const item = items[i];
			stmt.run(conversationId, i, item.itemType, item.messageId, item.summaryId, item.createdAt);
		}
	}
}
