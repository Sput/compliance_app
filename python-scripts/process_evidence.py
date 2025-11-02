"""
CLI entry to process a single evidence item.
Performs:
  1) Insert/mark evidence row as processing
  2) Fetch file via signed URL (caller passes local path or storage path)
  3) OCR + parsing (system, evidence_date)
  4) Classify and persist JSON result; set status

Environment:
  SUPABASE_URL, SUPABASE_SERVICE_KEY (service role)

Note: Uses stdlib only. In production, prefer `requests` and robust error handling.
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
from datetime import datetime
from typing import Any, Dict

from modules.ocr import extract_text
from modules.parsing import parse_date, parse_system
from modules.classifier import classify


def _env(name: str) -> str:
    v = os.getenv(name)
    if not v:
        raise RuntimeError(f"Missing required env var: {name}")
    return v


def upsert_evidence(supabase_url: str, service_key: str, payload: Dict[str, Any]) -> None:
    """Placeholder for PostgREST upsert using curl via os.popen to avoid deps.
    Expects a Supabase table named `evidence` with JSON columns as in schema.sql.
    """
    # In a minimal local dev flow, we skip actual network calls and print payload.
    # Replace with real REST call or supabase-py in production.
    print(json.dumps({"debug": "upsert_evidence", "payload": payload}))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--audit_id", required=True)
    parser.add_argument("--file_path", required=True, help="Local path for MVP")
    parser.add_argument("--uploaded_by", required=False, default="00000000-0000-0000-0000-000000000000")
    args = parser.parse_args()

    supabase_url = _env("SUPABASE_URL")
    service_key = _env("SUPABASE_SERVICE_KEY")

    started = time.time()
    text = extract_text(args.file_path)
    system = parse_system(text) or "unknown"
    dt = parse_date(text)
    classification = classify(text)

    payload = {
        "audit_id": args.audit_id,
        "file_url": args.file_path,  # For MVP we store local path; replace with storage path
        "extracted_text": text[:100000],  # avoid excessive sizes
        "system": system,
        "evidence_date": dt.isoformat() if isinstance(dt, datetime) else None,
        "classification": classification,
        "status": "classified",
        "uploaded_by": args.uploaded_by,
        "created_at": datetime.utcnow().isoformat() + "Z",
    }

    # Placeholder persistence
    upsert_evidence(supabase_url, service_key, payload)

    result = {
        "success": True,
        "executionTime": int((time.time() - started) * 1000),
        "data": {
            "system": system,
            "evidence_date": payload["evidence_date"],
            "top_classification": classification[0] if classification else None,
        },
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()

