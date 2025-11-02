"""
Parsing utilities to extract system identifier and evidence date from text.
Uses conservative regex patterns to avoid external dependencies.
"""
from __future__ import annotations
import re
from datetime import datetime
from typing import Optional, Tuple


DATE_PATTERNS = [
    r"(\d{4})[-/](\d{1,2})[-/](\d{1,2})",   # YYYY-MM-DD or YYYY/MM/DD
    r"(\d{1,2})[-/](\d{1,2})[-/](\d{4})",   # MM-DD-YYYY or MM/DD/YYYY
]


def parse_date(text: str) -> Optional[datetime]:
    for pat in DATE_PATTERNS:
        m = re.search(pat, text)
        if not m:
            continue
        groups = m.groups()
        try:
            if len(groups[0]) == 4:  # YYYY first
                year, month, day = int(groups[0]), int(groups[1]), int(groups[2])
            else:  # MM first
                month, day, year = int(groups[0]), int(groups[1]), int(groups[2])
            return datetime(year, month, day)
        except ValueError:
            continue
    return None


SYSTEM_PATTERNS = [
    r"system[:\s-]+([A-Za-z0-9_\-\.]+)",
    r"host[:\s-]+([A-Za-z0-9_\-\.]+)",
    r"server[:\s-]+([A-Za-z0-9_\-\.]+)",
]


def parse_system(text: str) -> Optional[str]:
    lowered = text.lower()
    for pat in SYSTEM_PATTERNS:
        m = re.search(pat, lowered)
        if m:
            return m.group(1)
    # Fallback heuristic: look for something that looks like a DNS label
    m = re.search(r"\b([a-z0-9][a-z0-9\-]{1,61}[a-z0-9](?:\.[a-z0-9\-]+)*)\b", lowered)
    if m:
        return m.group(1)
    return None

