from __future__ import annotations

from common import bootstrap_project, ensure_config, error_response, print_json, read_payload, run_mempalace


payload = ensure_config(read_payload())
query = str(payload.get("query", "")).strip()
if not query:
    print_json(error_response("INVALID_ARGUMENT", "Search query is required."))
    raise SystemExit(0)

try:
    bootstrapped = bootstrap_project(payload)
    result = run_mempalace(["search", query, "--wing", payload["projectWing"]], payload["palaceRoot"])
except FileNotFoundError as exc:
    print_json(error_response("MEMPALACE_UNAVAILABLE", str(exc)))
    raise SystemExit(0)
except RuntimeError as exc:
    print_json(error_response("MEMPALACE_INIT_FAILED", str(exc)))
    raise SystemExit(0)

if result.returncode != 0:
    message = (result.stderr or result.stdout or "MemPalace search failed").strip()
    print_json(error_response("MEMPALACE_SEARCH_FAILED", message))
    raise SystemExit(0)

summary = result.stdout.strip() or "No matching memory found."
print_json(
    {
        "ok": True,
        "query": query,
        "bootstrapped": bootstrapped,
        "summaryText": summary,
        "rawOutput": result.stdout,
    }
)
