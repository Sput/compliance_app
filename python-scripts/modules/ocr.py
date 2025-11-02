"""
Minimal OCR module.

Provider-agnostic interface with a conservative default that returns plain text
for common file types. In a real deployment, plug in Tesseract or a managed OCR
API here and branch by `PYTHON_OCR_PROVIDER`.
"""
from __future__ import annotations
import os
from typing import Optional


def extract_text(file_path: str) -> str:
    """Extract raw text from a local file path.

    Current stub behavior:
    - For .txt: read and return contents.
    - For other types: return a placeholder text noting filename.

    Replace with a production OCR pipeline as needed.
    """
    _, ext = os.path.splitext(file_path.lower())
    if ext == ".txt":
        try:
            with open(file_path, "r", encoding="utf-8", errors="ignore") as f:
                return f.read()
        except Exception:
            return ""

    # Placeholder for images/PDFs. Real OCR would go here.
    return f"[OCR STUB] Extracted text from {os.path.basename(file_path)}"

