# LCM Stage 1 schema (pi extension prototype)

This documents the SQLite schema introduced for Stage 1 storage groundwork.

Source of truth: `agent/extensions/lcm/schema.sql`

## Tables

### `conversations`

Tracks one logical LCM conversation per pi session identity.

- `conversation_id` (PK)
- `conversation_key` (UNIQUE)
- `session_file` (nullable)
- `cwd`
- `created_at`, `updated_at`

### `messages`

Canonical persisted message records used for future summarization/assembly.

- `message_id` (PK)
- `conversation_id` (FK -> conversations)
- `seq` (monotonic per conversation)
- `entry_id` (nullable pi session entry id)
- `role`
- `content_text` (plain text extraction)
- `content_json` (raw serialized content)
- `token_estimate`
- `created_at`
- `UNIQUE(conversation_id, entry_id)` for idempotent bootstrap/inserts

Index:
- `idx_messages_conversation_seq` on `(conversation_id, seq)`

### `summaries`

DAG summary nodes scaffold (populated in Stage 2).

- `summary_row_id` (PK)
- `summary_id` (UNIQUE)
- `conversation_id` (FK)
- `depth`
- `kind` (`leaf` or `condensed` planned)
- `content`
- `token_estimate`
- `earliest_at`, `latest_at`
- `created_at`

Index:
- `idx_summaries_conversation_depth` on `(conversation_id, depth, created_at)`

### `summary_messages`

Leaf-node to raw-message linkage (Stage 2+).

- `summary_id` (FK)
- `message_id` (FK)
- `ordinal`
- PK `(summary_id, message_id)`

### `summary_parents`

Condensed-node parent linkage for DAG traversal (Stage 2+).

- `summary_id` (FK)
- `parent_summary_id` (FK)
- `ordinal`
- PK `(summary_id, parent_summary_id)`

### `context_items`

Ordered render list for model-facing context assembly.

- `context_item_id` (PK)
- `conversation_id` (FK)
- `ordinal`
- `item_type` (`message` or `summary`)
- `message_id` (nullable; required when `item_type=message`)
- `summary_id` (nullable; required when `item_type=summary`)
- `created_at`

Checks enforce exactly one of `message_id` or `summary_id` based on `item_type`.

Index:
- `idx_context_items_conversation_ordinal` on `(conversation_id, ordinal)`

## Migration strategy

- DB migrations are versioned using `PRAGMA user_version`.
- Current migration version: `1`.
- Schema creation is idempotent (`CREATE TABLE/INDEX IF NOT EXISTS`).

## Message canonicalization rules (Stage 1)

Persisted fields for each message:
- `role`: pi role (`user`, `assistant`, `toolResult`, etc.)
- `content_text`: flattened text for summarization inputs
- `content_json`: serialized original content shape for reconstruction and fidelity
- `token_estimate`: coarse `ceil(char_count / 4)` estimate

Bootstrap path ingests existing branch messages once per session start/switch; runtime path appends on `message_end`.
