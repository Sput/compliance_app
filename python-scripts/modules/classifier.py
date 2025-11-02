"""
Lightweight text classifier mapping evidence to framework controls.
This stub uses keyword heuristics and returns a ranked list of candidates.

Output schema (list):
  [{
     "framework_id": str,
     "control_id": str,       # control UUID
     "control_code": str,     # human code like "10.2.1"
     "confidence": float
  }]
"""
from __future__ import annotations
from typing import Dict, List


# Minimal label space seeded in seeds/seeds.sql
PCI_FRAMEWORK_ID = "11111111-1111-1111-1111-111111111111"
CTRL_LOGGING_ID  = "22222222-2222-2222-2222-222222222222"  # 10.2.1
CTRL_AUTH_ID     = "33333333-3333-3333-3333-333333333333"  # 8.2.3


def classify(text: str) -> List[Dict]:
    lowered = text.lower()
    scores: List[Dict] = []

    score_logging = 0.0
    for kw in ("log", "audit trail", "siem", "splunk"):
        if kw in lowered:
            score_logging += 0.25
    if score_logging:
        scores.append({
            "framework_id": PCI_FRAMEWORK_ID,
            "control_id": CTRL_LOGGING_ID,
            "control_code": "10.2.1",
            "confidence": min(1.0, score_logging)
        })

    score_auth = 0.0
    for kw in ("password", "mfa", "2fa", "auth", "login"):
        if kw in lowered:
            score_auth += 0.2
    if score_auth:
        scores.append({
            "framework_id": PCI_FRAMEWORK_ID,
            "control_id": CTRL_AUTH_ID,
            "control_code": "8.2.3",
            "confidence": min(1.0, score_auth)
        })

    scores.sort(key=lambda x: x["confidence"], reverse=True)
    return scores

