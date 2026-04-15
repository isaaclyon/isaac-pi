from __future__ import annotations

from common import bootstrap_project, count_ingest_files, ensure_config, load_state, mempalace_command, print_json, read_payload, error_response


payload = ensure_config(read_payload())
mempalace_available = mempalace_command() is not None
bootstrapped = False
if mempalace_available:
    try:
        bootstrapped = bootstrap_project(payload)
    except (FileNotFoundError, RuntimeError) as exc:
        print_json(error_response("MEMPALACE_INIT_FAILED", str(exc)))
        raise SystemExit(0)

state = load_state(payload["statePath"])
print_json(
    {
        "ok": True,
        "mempalaceAvailable": mempalace_available,
        "bootstrapped": bootstrapped,
        "projectWing": payload["projectWing"],
        "memoryRoot": payload["memoryRoot"],
        "palaceRoot": payload["palaceRoot"],
        "lastSync": state.get("lastSync"),
        "stats": {
            "ingestFiles": count_ingest_files(payload["ingestRoot"]),
            "indexedItems": int(state.get("indexedItems", 0) or 0),
        },
    }
)
