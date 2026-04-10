from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


REQUIRED_CONFIG_KEYS = [
    "projectRoot",
    "projectWing",
    "memoryRoot",
    "palaceRoot",
    "ingestRoot",
    "statePath",
]


def project_bootstrap_marker(project_root: str) -> Path:
    return Path(project_root) / "mempalace.yaml"


def read_payload() -> dict[str, Any]:
    raw = sys.stdin.read()
    if not raw.strip():
        raise ValueError("Expected JSON payload on stdin")
    payload = json.loads(raw)
    if not isinstance(payload, dict):
        raise ValueError("Expected top-level JSON object")
    return payload


def require_keys(payload: dict[str, Any], keys: list[str]) -> None:
    missing = [key for key in keys if payload.get(key) in (None, "")]
    if missing:
        raise ValueError(f"Missing required fields: {', '.join(missing)}")


def ensure_config(payload: dict[str, Any]) -> dict[str, Any]:
    require_keys(payload, REQUIRED_CONFIG_KEYS)
    return payload


def print_json(data: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(data))
    sys.stdout.flush()


def mempalace_command() -> str | None:
    return shutil.which("mempalace")


def load_state(state_path: str) -> dict[str, Any]:
    path = Path(state_path)
    if not path.exists():
        return {"version": 1, "lastSync": None}
    try:
        value = json.loads(path.read_text("utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"Invalid state file at {state_path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ValueError(f"Invalid state file at {state_path}: expected object")
    return value


def save_state(state_path: str, state: dict[str, Any]) -> None:
    path = Path(state_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(state, indent=2, sort_keys=True) + os.linesep, "utf-8")


def count_ingest_files(ingest_root: str) -> int:
    path = Path(ingest_root)
    if not path.exists():
        return 0
    return sum(1 for item in path.rglob("*.json") if item.is_file())


def run_mempalace(args: list[str], palace_root: str) -> subprocess.CompletedProcess[str]:
    command = mempalace_command()
    if not command:
        raise FileNotFoundError("mempalace CLI is not installed or not on PATH")
    return subprocess.run([command, "--palace", palace_root, *args], capture_output=True, text=True, check=False)


def bootstrap_project(payload: dict[str, Any]) -> bool:
    marker = project_bootstrap_marker(str(payload["projectRoot"]))
    if marker.exists():
        return False

    result = run_mempalace(["init", str(payload["projectRoot"]), "--yes"], str(payload["palaceRoot"]))
    if result.returncode != 0:
        message = (result.stderr or result.stdout or "MemPalace bootstrap failed").strip()
        raise RuntimeError(message)
    return True


def sanitized_timestamp(value: str) -> str:
    return value.replace(":", "-").replace(".", "-")


def error_response(code: str, message: str) -> dict[str, Any]:
    return {"ok": False, "code": code, "error": message}
