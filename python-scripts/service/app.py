"""
FastAPI service exposing /process-evidence for the MVP.
This mirrors the CLI in process_evidence.py, but behind an HTTP interface.
"""
from __future__ import annotations
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import os
from datetime import datetime

from modules.ocr import extract_text
from modules.parsing import parse_date, parse_system
from modules.classifier import classify


class ProcessEvidenceRequest(BaseModel):
    audit_id: str
    file_path: str  # MVP expects local path or mounted storage file
    uploaded_by: str | None = None


app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("ALLOWED_ORIGIN", "*")],
    allow_credentials=True,
    allow_methods=["POST"],
    allow_headers=["*"]
)


@app.post("/process-evidence")
def process_evidence(body: ProcessEvidenceRequest):
    try:
        text = extract_text(body.file_path)
        system = parse_system(text) or "unknown"
        dt = parse_date(text)
        classification = classify(text)

        return {
            "success": True,
            "data": {
                "system": system,
                "evidence_date": dt.isoformat() if dt else None,
                "classification": classification,
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

