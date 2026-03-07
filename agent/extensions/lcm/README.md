# LCM extension prototype (Stage 1)

This extension adds SQLite-backed persistence groundwork for LCM-style context management.

## Status

Stage 1 only:
- Conversation/message persistence
- DAG scaffolding tables
- Ordered context item tracking for message rows
- Feature flag + config resolution

Not yet implemented:
- DAG summarization passes
- context assembly override

## Enable

By default this extension is disabled.

Set env var:

```bash
PI_LCM_ENABLED=true
```

Optional overrides:

- `PI_LCM_DB_PATH`
- `PI_LCM_FRESH_TAIL_COUNT`
- `PI_LCM_CONTEXT_THRESHOLD`
- `PI_LCM_LEAF_CHUNK_TOKENS`
- `PI_LCM_INCREMENTAL_MAX_DEPTH`

Project config file override:

- `.pi/lcm.json`

## Smoke test

```bash
node agent/extensions/lcm/smoke-test.mjs
```
