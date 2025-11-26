#!/usr/bin/env python3
"""
HITL engine CLI (scaffold)

Subcommands (reads JSON from stdin, writes JSON to stdout):
  - start
  - run-stage
  - apply-edits
  - summarize

Notes:
  - This is a stub to enable end-to-end wiring. It mirrors the contracts
    and provides placeholder outputs. Stage internals can be enhanced later.
"""
from __future__ import annotations

import json
import sys
import uuid
from dataclasses import dataclass, asdict
from typing import Any, Dict, List, Optional
import os


STAGES: List[str] = [
    "ingest_text",
    "date",
    "action_describer",
    "control_candidates",
    "finalize_classification",
]


def read_stdin_json() -> Dict[str, Any]:
    data = sys.stdin.read()
    if not data:
        return {}
    try:
        return json.loads(data)
    except Exception as e:
        err = {"error": {"code": "invalid_json", "message": str(e)}}
        print(json.dumps(err), file=sys.stdout)
        sys.exit(2)


def write_ok(payload: Dict[str, Any]) -> None:
    print(json.dumps(payload, ensure_ascii=False))


def write_err(code: str, message: str, details: Optional[Dict[str, Any]] = None, exit_code: int = 1) -> None:
    err = {"error": {"code": code, "message": message}}
    if details:
        err["error"]["details"] = details
    print(json.dumps(err, ensure_ascii=False))
    sys.exit(exit_code)


def cmd_start(body: Dict[str, Any]) -> None:
    evidence_id = body.get("evidence_id")
    session_id = body.get("session_id") or str(uuid.uuid4())
    write_ok({
        "session": {
            "session_id": session_id,
            "evidence_id": evidence_id,
            "current_stage": "ingest_text",
            "status": "active",
        }
    })


def _stage_ingest_text(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = payload.get("text") or ""
    source = payload.get("source") or "unknown"
    truncated = False
    length = len(text)
    if length > 200_000:
        text = text[:200_000]
        truncated = True
        length = len(text)
    return {"text": text, "source": source, "truncated": truncated, "length": length}


def _stage_extract_system(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = (payload.get("text") or "").lower()
    # Simple keyword-based system detector
    rules = [
        ("AWS", [" aws ", "amazon web services", "cloudtrail", "cloudwatch", "s3", "iam "]),
        ("GCP", [" gcp ", "google cloud", "stackdriver", "gcs", "bigquery"]),
        ("Azure", [" azure ", "microsoft azure", "log analytics", "blob storage"]),
        ("Okta", [" okta ", "sso okta", "okta verify"]),
        ("GitHub", [" github ", "gh actions", "octokit", "dependabot"]),
        ("GitLab", [" gitlab ", "gitlab ci"]),
        ("Snowflake", [" snowflake ", "warehouse snowflake"]),
        ("Datadog", [" datadog ", "ddog", "apm dd" ]),
        ("Jira", [" jira ", "atlassian jira"]),
        ("Slack", [" slack ", "slackbot"]),
        ("Salesforce", [" salesforce ", "sfdc "]),
    ]
    found: List[Dict[str, Any]] = []
    for label, keys in rules:
        hits = [k.strip() for k in keys if k in f" {text} "]
        if hits:
            # Confidence scales with number of unique hits
            conf = min(0.3 + 0.2 * len(hits), 0.95)
            found.append({"label": label, "confidence": conf, "hits": hits})
    if not found:
        # try generic cloud hints
        generic_hits = [k for k in ["cloud", "iam", "bucket", "project", "subscription"] if k in text]
        if generic_hits:
            return {"system": "Unknown (Cloud)", "confidence": 0.45, "rationale": f"Generic hints: {', '.join(generic_hits)}"}
        return {"system": "Unknown", "confidence": 0.2, "rationale": "No known system keywords detected"}
    # Pick the highest confidence
    best = sorted(found, key=lambda x: x["confidence"], reverse=True)[0]
    return {"system": best["label"], "confidence": best["confidence"], "rationale": f"Matched: {', '.join(best['hits'])}"}


def _month_name_to_num() -> Dict[str, int]:
    months = {
        "january": 1, "february": 2, "march": 3, "april": 4, "may": 5, "june": 6,
        "july": 7, "august": 8, "september": 9, "october": 10, "november": 11, "december": 12,
        "jan": 1, "feb": 2, "mar": 3, "apr": 4, "jun": 6, "jul": 7, "aug": 8, "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
    }
    return months


def _safe_iso(y: int, m: int, d: int) -> Optional[str]:
    from datetime import date
    try:
        return date(y, m, d).isoformat()
    except Exception:
        return None


def _find_dates(text: str) -> List[Dict[str, Any]]:
    import re
    t = text
    out: List[Dict[str, Any]] = []
    months = _month_name_to_num()

    # ISO-like: YYYY-MM-DD or YYYY/MM/DD
    for m in re.finditer(r"\b(20\d{2}|19\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b", t):
        y, mo, da = int(m.group(1)), int(m.group(2)), int(m.group(3))
        iso = _safe_iso(y, mo, da)
        if iso:
            out.append({"iso": iso, "span": [m.start(), m.end()], "label": "iso"})

    # Month DD, YYYY and DD Month YYYY
    # Month names
    month_names = r"Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t|tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?"
    # e.g., October 22 2025 or October 22, 2025
    for m in re.finditer(rf"\b({month_names})\s+(\d{{1,2}})(?:,)?\s+(\d{{4}})\b", t, re.IGNORECASE):
        mo_name, da, y = m.group(1), int(m.group(2)), int(m.group(3))
        mo = months.get(mo_name.lower(), 0)
        iso = _safe_iso(y, mo, da)
        if iso:
            out.append({"iso": iso, "span": [m.start(), m.end()], "label": "mdy"})
    # e.g., 22 October 2025
    for m in re.finditer(rf"\b(\d{{1,2}})\s+({month_names})\s+(\d{{4}})\b", t, re.IGNORECASE):
        da, mo_name, y = int(m.group(1)), m.group(2), int(m.group(3))
        mo = months.get(mo_name.lower(), 0)
        iso = _safe_iso(y, mo, da)
        if iso:
            out.append({"iso": iso, "span": [m.start(), m.end()], "label": "dmy"})

    # De-duplicate by iso, keep first occurrence
    seen = set()
    uniq: List[Dict[str, Any]] = []
    for d in out:
        if d["iso"] in seen:
            continue
        seen.add(d["iso"])
        uniq.append(d)
    return uniq


def _choose_evidence_date(text: str, cands: List[Dict[str, Any]]) -> Dict[str, Any]:
    # Heuristics: look for labels near date spans
    import math
    keywords = [
        "report date", "effective", "as of", "evidence date", "signed", "generated", "issued", "date:"
    ]
    best = None
    best_score = -1.0
    for c in cands:
        span = c.get("span", [0, 0])
        start = max(0, span[0] - 80)
        end = min(len(text), span[1] + 40)
        window = text[start:end].lower()
        score = 0.5  # base
        hits = [kw for kw in keywords if kw in window]
        if hits:
            score += 0.2 + 0.1 * min(3, len(hits))
        # Freshness: later years slightly higher
        try:
            y = int(c["iso"][0:4])
            score += (y - 2000) * 0.001
        except Exception:
            pass
        if score > best_score:
            best_score = score
            best = {"evidence_date": c["iso"], "confidence": min(0.99, round(score, 2)), "rationale": f"Context hits: {', '.join(hits) if hits else 'none'}"}
    if not best:
        return {"evidence_date": None, "confidence": 0.0, "rationale": "No dates detected"}
    return best


def _stage_extract_date(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = payload.get("text") or ""
    cands = _find_dates(text)
    choice = _choose_evidence_date(text, cands) if cands else {"evidence_date": None, "confidence": 0.0, "rationale": "No dates detected"}
    return {
        "evidence_date": choice["evidence_date"],
        "candidates": [c["iso"] for c in cands],
        "confidence": choice["confidence"],
        "rationale": choice["rationale"],
    }


def _stage_date_guard(payload: Dict[str, Any]) -> Dict[str, Any]:
    from datetime import date
    evidence_date = payload.get("evidence_date")
    window = payload.get("window") or {}
    if not evidence_date:
        return {"status": "unknown", "parsed_date": None, "reason": "No evidence_date provided"}
    try:
        y, m, d = [int(x) for x in str(evidence_date).split("-")[:3]]
        ev = date(y, m, d)
    except Exception:
        return {"status": "unknown", "parsed_date": None, "reason": "Invalid date format"}
    try:
        if not window.get("start") or not window.get("end"):
            return {"status": "unknown", "parsed_date": ev.isoformat(), "reason": "No window provided"}
        ys, ms, ds = [int(x) for x in str(window["start"]).split("-")[:3]]
        ye, me, de = [int(x) for x in str(window["end"]).split("-")[:3]]
        ws, we = date(ys, ms, ds), date(ye, me, de)
        if ws <= ev <= we:
            return {"status": "pass", "parsed_date": ev.isoformat(), "reason": "Within window (inclusive)"}
        else:
            return {"status": "fail", "parsed_date": ev.isoformat(), "reason": "Outside window"}
    except Exception:
        return {"status": "unknown", "parsed_date": ev.isoformat(), "reason": "Invalid window"}


def _stage_date(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Combined date step: extract date and validate against window.

    Input: { text, window?: {start,end} }
    Output: {
      evidence_date, candidates, confidence, rationale,  # from extract
      status, reason                                     # from guard
    }
    """
    text = payload.get("text") or ""
    window = payload.get("window") or {}
    ext = _stage_extract_date({"text": text})
    guard = _stage_date_guard({"evidence_date": ext.get("evidence_date"), "window": window})
    out = dict(ext)
    out.update({"status": guard.get("status"), "reason": guard.get("reason")})
    return out


# --- Agent-style helpers (HITL agents) -------------------------------------------------------

def date_guard_agent(evidence_date: Optional[str], window: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Date Guard Agent: validate evidence_date against window.

    Input: evidence_date (YYYY-MM-DD) and window {start, end}. Returns {status, parsed_date, reason}.
    """
    return _stage_date_guard({"evidence_date": evidence_date, "window": window})


def action_describer_agent(text: str, max_words: int = 120) -> str:
    """Action Describer Agent: summarize actions from text in <= max_words.

    Heuristic implementation: collapse whitespace and truncate to max_words words,
    favoring sentence boundaries when possible.
    """
    import re
    body = re.sub(r"\s+", " ", text or "").strip()
    if not body:
        return ""
    # Split into words; truncate to max_words
    words = body.split()
    if len(words) <= max_words:
        return body
    truncated = " ".join(words[:max_words])
    # Try to end on the last period within the truncated section
    cut = truncated.rfind('.')
    if cut >= max(40, int(len(truncated) * 0.6)):
        return truncated[: cut + 1]
    return truncated


def control_assigner_agent(text: str) -> Dict[str, Any]:
    """Control Assigner Agent: choose a single best-matching control from text.

    Returns {selection: {id,label,confidence}, rationale} using the same rules as candidates.
    """
    cand_out = _stage_control_candidates({"text": text})
    cands = cand_out.get("candidates") or []
    if not isinstance(cands, list) or not cands:
        return {"selection": None, "rationale": "no candidates"}
    sel = sorted(cands, key=lambda c: c.get("confidence", 0), reverse=True)[0]
    return {"selection": sel, "rationale": f"picked highest confidence: {sel.get('confidence')}"}

# ---- Control specs loading (Supabase REST or local file) ------------------------------------
_SPECS_CACHE: Optional[List[Dict[str, Any]]] = None
_SPECS_CACHE_AT: Optional[float] = None

def _http_get(url: str, headers: Dict[str, str], timeout: int = 6) -> Optional[str]:
    try:
        import urllib.request
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec
            return resp.read().decode('utf-8', errors='ignore')
    except Exception:
        return None

def _load_specs_from_supabase() -> Optional[List[Dict[str, Any]]]:
    base = os.getenv('SUPABASE_URL') or os.getenv('NEXT_PUBLIC_SUPABASE_URL')
    key = os.getenv('SUPABASE_SERVICE_KEY')
    if not base or not key:
        return None
    url = f"{base.rstrip('/')}/rest/v1/control_specs?select=id,control_id,specification&limit=10000"
    headers = { 'apikey': key, 'Authorization': f"Bearer {key}" }
    txt = _http_get(url, headers=headers)
    if not txt:
        return None
    try:
        arr = json.loads(txt)
        out: List[Dict[str, Any]] = []
        for row in arr:
            cid = str(row.get('control_id') or '').strip()
            spec = str(row.get('specification') or '').strip()
            if cid and spec:
                out.append({'control_id': cid, 'specification': spec, 'id': str(row.get('id') or '')})
        return out
    except Exception:
        return None

def _load_specs_local_fallback() -> Optional[List[Dict[str, Any]]]:
    try:
        here = os.path.dirname(os.path.dirname(__file__))
        path = os.path.join(here, 'db', 'control_specs.json')
        if not os.path.exists(path):
            return None
        with open(path, 'r', encoding='utf-8') as f:
            arr = json.load(f)
        out: List[Dict[str, Any]] = []
        for row in arr:
            cid = str(row.get('control_id') or '').strip()
            spec = str(row.get('specification') or '').strip()
            if cid and spec:
                out.append({'control_id': cid, 'specification': spec, 'id': str(row.get('id') or '')})
        return out
    except Exception:
        return None

def _get_control_specs_cached() -> List[Dict[str, Any]]:
    import time
    global _SPECS_CACHE, _SPECS_CACHE_AT
    now = time.time()
    if _SPECS_CACHE and _SPECS_CACHE_AT and (now - _SPECS_CACHE_AT) < 15 * 60:
        return _SPECS_CACHE
    specs = _load_specs_from_supabase() or _load_specs_local_fallback() or []
    _SPECS_CACHE, _SPECS_CACHE_AT = specs, now
    return specs


def _stage_control_candidates(payload: Dict[str, Any]) -> Dict[str, Any]:
    # Combine action summary (if any) with full text for matching
    text_raw = ((payload.get("actions_summary") or "") + "\n" + (payload.get("text") or "")).strip()
    text = text_raw.lower()

    # Try specs-driven scoring first
    specs = _get_control_specs_cached()
    cands: List[Dict[str, Any]] = []
    if specs:
        import re
        stop = set([
            'the','and','for','with','that','this','from','are','was','were','have','has','had','shall','should','will','may','can','must','of','to','in','on','by','or','an','a','as','be','is','it','at','we','you','they','their','our'
        ])
        tokens = [t for t in re.findall(r"[a-z0-9]+", text) if t not in stop and len(t) > 2]
        ev_counts: Dict[str, int] = {}
        for t in tokens:
            ev_counts[t] = ev_counts.get(t, 0) + 1

        scored: List[Dict[str, Any]] = []
        for row in specs:
            cid = str(row.get('control_id') or '').strip()
            spec = str(row.get('specification') or row.get('title') or '').strip()
            rid = str(row.get('id') or '').strip()  # uuid of control/spec row if provided by API/view
            if not cid or not spec:
                continue
            stokens = [t for t in re.findall(r"[a-z0-9]+", spec.lower()) if t not in stop and len(t) > 2][:120]
            score = 0.0
            hits: List[str] = []
            for t in stokens:
                c = ev_counts.get(t)
                if c:
                    score += 1.0 + 0.1 * min(5, c-1)
                    if len(hits) < 6:
                        hits.append(t)
            if score > 0:
                scored.append({
                    "id": cid,              # human-readable control code
                    "uuid": rid or None,     # uuid if available from view
                    "label": cid,
                    "confidence": score,
                    "rationale": f"Spec overlap: {', '.join(hits)}",
                })
        if scored:
            max_score = max(x['confidence'] for x in scored) or 1.0
            for x in scored:
                x['confidence'] = round(0.5 + 0.49 * (x['confidence'] / max_score), 2)
            cands = sorted(scored, key=lambda c: c['confidence'], reverse=True)[:7]

    # Fallback: simple keyword rules
    if not cands:
        rules = [
            ("CTRL-PASS-001", "Password Policy", ["password policy", "passwords", "complexity", "rotate", "expiration", "length"]),
            ("CTRL-AUTH-001", "Multi-Factor Authentication", ["mfa", "2fa", "multi-factor", "two-factor", "otp", "okta" ]),
            ("CTRL-ENC-001", "Encryption Controls", ["encryption", "aes-256", "tls", "at rest", "in transit", "kms"]),
            ("CTRL-LOG-001", "Logging and Monitoring", ["logging", "audit log", "cloudtrail", "siem", "splunk", "datadog", "cloudwatch"]),
            ("CTRL-IR-001", "Incident Response", ["incident response", "irp", "playbook", "pagerduty", "sev", "major incident"]),
        ]
        for cid, label, keys in rules:
            hits = [k for k in keys if k in text]
            if hits:
                conf = min(0.4 + 0.1 * len(hits), 0.95)
                cands.append({"id": cid, "label": label, "confidence": round(conf, 2), "rationale": f"Matched: {', '.join(hits)}"})
        if not cands:
            cands = [{"id": "CTRL-GEN-000", "label": "General Control", "confidence": 0.25, "rationale": "No specific overlaps detected"}]

    return {"candidates": cands}


# Removed select_control stage; selection is made in control_candidates step


def _stage_finalize_classification(payload: Dict[str, Any]) -> Dict[str, Any]:
    # Echo a simple classification summary
    evidence_date = payload.get("evidence_date")
    selection = payload.get("selection")
    actions_summary = payload.get("actions_summary")
    classification = {"evidence_date": evidence_date, "control": selection, "actions_summary": actions_summary}
    summary = "HITL classification summary"
    return {"classification": classification, "summary": summary}


def _stage_action_describer(payload: Dict[str, Any]) -> Dict[str, Any]:
    text = payload.get("text") or ""
    summary = action_describer_agent(text)
    return {"actions_summary": summary}


def cmd_run_stage(body: Dict[str, Any]) -> None:
    import time
    t0 = time.perf_counter()
    stage = body.get("stage")
    payload = body.get("payload") or {}
    if stage not in STAGES:
        write_err("invalid_stage", f"Unknown stage: {stage}")
    if stage == "ingest_text":
        model_output = _stage_ingest_text(payload)
    elif stage == "date":
        model_output = _stage_date(payload)
    elif stage == "action_describer":
        model_output = _stage_action_describer(payload)
    elif stage == "control_candidates":
        model_output = _stage_control_candidates(payload)
    elif stage == "finalize_classification":
        model_output = _stage_finalize_classification(payload)
    else:
        write_err("invalid_stage", f"Unhandled stage: {stage}")
        return
    elapsed_ms = int((time.perf_counter() - t0) * 1000)
    write_ok({"stage": stage, "model_output": model_output, "meta": {"elapsed_ms": elapsed_ms}})


def cmd_apply_edits(body: Dict[str, Any]) -> None:
    stage = body.get("stage")
    model_output = body.get("model_output") or {}
    human_input = body.get("human_input") or {}

    # Naive merge: human edits override model output fields
    decided = dict(model_output)
    edits = human_input.get("edits") or {}
    if isinstance(edits, dict):
        decided.update(edits)
    write_ok({"stage": stage, "decided_output": decided})


def cmd_summarize(body: Dict[str, Any]) -> None:
    # For now, just echo what we have
    write_ok({"summary": {"note": "stub summarize", "input": body}})


def main(argv: List[str]) -> None:
    if len(argv) < 2:
        write_err("usage", "Expected subcommand: start|run-stage|apply-edits|summarize", exit_code=2)
    sub = argv[1]
    body = read_stdin_json()
    if sub == "start":
        cmd_start(body)
    elif sub == "run-stage":
        cmd_run_stage(body)
    elif sub == "apply-edits":
        cmd_apply_edits(body)
    elif sub == "summarize":
        cmd_summarize(body)
    else:
        write_err("unknown_subcommand", f"Unknown subcommand: {sub}")


if __name__ == "__main__":
    main(sys.argv)
