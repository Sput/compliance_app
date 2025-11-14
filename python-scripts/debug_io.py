from __future__ import annotations
import json
import os
import time
from typing import Any


def _debug_dir() -> str | None:
    """
    Return a writable debug directory only when explicitly configured.

    If AGENT_DEBUG_DIR is not set, return None so callers can skip writing.
    This prevents creating local tmp_outputs during normal operation.
    """
    d = os.getenv("AGENT_DEBUG_DIR")
    if not d:
        return None
    try:
        os.makedirs(d, exist_ok=True)
    except Exception:
        # Directory creation failures are non-fatal for debug output
        return None
    return d


def _truncate(obj: Any, depth: int = 0, max_depth: int = 2, max_str: int = 10000) -> Any:
    try:
        if depth > max_depth:
            return "<truncated>"
        if isinstance(obj, str):
            if len(obj) > max_str:
                return obj[:max_str] + f"...<truncated {len(obj)-max_str} chars>"
            return obj
        if isinstance(obj, dict):
            return {k: _truncate(v, depth + 1, max_depth, max_str) for k, v in obj.items()}
        if isinstance(obj, list):
            return [_truncate(v, depth + 1, max_depth, max_str) for v in obj[:1000]]
        return obj
    except Exception:
        return "<unserializable>"


def write_debug(tag: str, payload: Any) -> None:
    """Optionally write a JSON snapshot when AGENT_DEBUG_DIR is set. Never raises."""
    try:
        d = _debug_dir()
        if not d:
            return
        ts = time.strftime("%Y%m%d-%H%M%S")
        millis = int((time.time() % 1) * 1000)
        fname = f"{ts}-{millis:03d}_{tag}.json"
        path = os.path.join(d, fname)
        data = _truncate(payload)
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
    except Exception:
        # Debugging must not break processing
        pass
