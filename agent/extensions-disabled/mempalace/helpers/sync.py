from __future__ import annotations

import json
from pathlib import Path

from common import (
    bootstrap_project,
    ensure_config,
    error_response,
    load_state,
    print_json,
    read_payload,
    run_mempalace,
    sanitized_timestamp,
    save_state,
)


payload = ensure_config(read_payload())
chunk = payload.get("chunk")
if not isinstance(chunk, dict):
    print_json(error_response("INVALID_ARGUMENT", "Sync chunk is required."))
    raise SystemExit(0)

required_chunk_keys = ["createdAt", "entryStartId", "entryEndId", "messages"]
missing = [key for key in required_chunk_keys if chunk.get(key) in (None, "")]
if missing:
    print_json(error_response("INVALID_ARGUMENT", f"Sync chunk missing required fields: {', '.join(missing)}"))
    raise SystemExit(0)

messages = chunk.get("messages")
if not isinstance(messages, list) or len(messages) == 0:
    print_json(error_response("INVALID_ARGUMENT", "Sync chunk must contain at least one message."))
    raise SystemExit(0)

try:
    bootstrapped = bootstrap_project(payload)
except FileNotFoundError as exc:
    print_json(error_response("MEMPALACE_UNAVAILABLE", str(exc)))
    raise SystemExit(0)
except RuntimeError as exc:
    print_json(error_response("MEMPALACE_INIT_FAILED", str(exc)))
    raise SystemExit(0)

ingest_root = Path(payload["ingestRoot"])
ingest_root.mkdir(parents=True, exist_ok=True)
filename = f"{sanitized_timestamp(str(chunk['createdAt']))}_{chunk['entryStartId']}_{chunk['entryEndId']}.json"
chunk_path = ingest_root / filename
chunk_path.write_text(json.dumps(chunk, indent=2, sort_keys=True) + "\n", "utf-8")

try:
    result = run_mempalace(["mine", str(chunk_path), "--mode", "convos", "--wing", payload["projectWing"]], payload["palaceRoot"])
except FileNotFoundError as exc:
    print_json(error_response("MEMPALACE_UNAVAILABLE", str(exc)))
    raise SystemExit(0)

if result.returncode != 0:
    chunk_path.unlink(missing_ok=True)
    message = (result.stderr or result.stdout or "MemPalace sync failed").strip()
    print_json(error_response("MEMPALACE_SYNC_FAILED", message))
    raise SystemExit(0)

previous_state = load_state(payload["statePath"])
state = {
    "version": 1,
    "projectRoot": payload["projectRoot"],
    "projectWing": payload["projectWing"],
    "indexedItems": int(previous_state.get("indexedItems", 0) or 0) + 1,
    "lastSync": {
        "sessionFile": chunk.get("sessionFile"),
        "entryId": chunk["entryEndId"],
        "timestamp": chunk["createdAt"],
    },
}
save_state(payload["statePath"], state)

print_json(
    {
        "ok": True,
        "saved": True,
        "bootstrapped": bootstrapped,
        "indexedCount": 1,
        "chunkPath": str(chunk_path),
        "lastSync": state["lastSync"],
        "rawOutput": result.stdout.strip(),
    }
)
