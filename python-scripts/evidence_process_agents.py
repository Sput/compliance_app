"""
Three sub-agents for evidence processing as described in agent_dev_plan.md (section: 3) Build the three sub-agents).

Agents (each constructed via create_react_agent):
  1) Date Guard Agent
     - Goal: Given evidence text and a date window, decide PASS/FAIL with parsed_date and reason.
     - Tools: extract_dates(text), check_date_range(date, start, end)

  2) Action Describer Agent
     - Goal: Summarize in <=120 words the actions the document prescribes/records.
     - Tools: none (pure LLM)

  3) Control Assigner Agent
     - Goal: Choose a single controls.control_id and brief rationale based on the actions summary + text.
     - Tools: list_controls(keywords) → returns candidate controls (control_id + title)

Note: This module focuses on building the sub-agents only. Wrapping these agents as tools
for a supervisor (and DB wiring for list_controls) is handled in later steps of the plan.
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any, Dict, Iterable, List, Optional, Tuple


# Debug writer (works both as package and as script import)
try:  # first try relative import when used as a package
    from .debug_io import write_debug  # type: ignore
except Exception:
    try:  # fallback to local import when executed as a loose module
        from debug_io import write_debug  # type: ignore
    except Exception:
        def write_debug(tag: str, payload: Any) -> None:  # type: ignore
            pass


OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

# --- Optional, lazy imports for LangChain/LangGraph -------------------------------------------

def _missing_dep_error(pkg: str) -> RuntimeError:
    return RuntimeError(
        f"Missing dependency: {pkg}. Install with: pip install \"langchain>=0.3\" \"langgraph>=0.2\" langchain-openai"
    )


def _import_tool():
    try:
        from langchain_core.tools import tool  # type: ignore
        return tool
    except Exception as e:
        raise _missing_dep_error("langchain_core") from e


def _import_prompt():
    try:
        from langchain_core.prompts import ChatPromptTemplate  # type: ignore
        return ChatPromptTemplate
    except Exception as e:
        raise _missing_dep_error("langchain_core") from e


def _import_react_agent():
    try:
        from langgraph.prebuilt import create_react_agent  # type: ignore
        return create_react_agent
    except Exception as e:
        raise _missing_dep_error("langgraph") from e


def _import_openai_llm():
    try:
        from langchain_openai import ChatOpenAI  # type: ignore
        return ChatOpenAI
    except Exception as e:
        raise _missing_dep_error("langchain-openai") from e


def _import_messages():
    try:
        from langchain_core.messages import HumanMessage  # type: ignore
        return HumanMessage
    except Exception as e:
        raise _missing_dep_error("langchain_core") from e


def _import_system_message():
    try:
        from langchain_core.messages import SystemMessage  # type: ignore
        return SystemMessage
    except Exception as e:
        raise _missing_dep_error("langchain_core") from e


# --- Deterministic helper utilities -----------------------------------------------------------

_MONTHS = {
    "jan": 1,
    "january": 1,
    "feb": 2,
    "february": 2,
    "mar": 3,
    "march": 3,
    "apr": 4,
    "april": 4,
    "may": 5,
    "jun": 6,
    "june": 6,
    "jul": 7,
    "july": 7,
    "aug": 8,
    "august": 8,
    "sep": 9,
    "sept": 9,
    "september": 9,
    "oct": 10,
    "october": 10,
    "nov": 11,
    "november": 11,
    "dec": 12,
    "december": 12,
}


def _to_date_safe(y: int, m: int, d: int) -> Optional[date]:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _parse_any_date(text: str) -> Optional[date]:
    """Best-effort date parsing for common formats without external deps.

    Supports:
      - YYYY[-/.]MM[-/.]DD
      - MM[-/.]DD[-/.]YYYY
      - MonthName D, YYYY (e.g., March 5, 2024)
    """
    s = text.strip()

    # YYYY-MM-DD
    m = re.search(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", s)
    if m:
        y, mm, dd = int(m.group(1)), int(m.group(2)), int(m.group(3))
        dt = _to_date_safe(y, mm, dd)
        if dt:
            return dt

    # MM-DD-YYYY
    m = re.search(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", s)
    if m:
        mm, dd, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        dt = _to_date_safe(y, mm, dd)
        if dt:
            return dt

    # MonthName D, YYYY
    m = re.search(r"\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\b", s)
    if m:
        mon = _MONTHS.get(m.group(1).lower())
        if mon:
            dd, y = int(m.group(2)), int(m.group(3))
            dt = _to_date_safe(y, mon, dd)
            if dt:
                return dt

    # MonthName D YYYY (no comma, optional ordinal suffix)
    m = re.search(r"\b([A-Za-z]{3,9})\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{4})\b", s)
    if m:
        mon = _MONTHS.get(m.group(1).lower())
        if mon:
            dd, y = int(m.group(2)), int(m.group(3))
            dt = _to_date_safe(y, mon, dd)
            if dt:
                return dt

    return None


def _iso_date(d: date) -> str:
    return d.isoformat()


# --- Tools (deterministic) --------------------------------------------------------------------

tool = _import_tool()

# Marker signalling for first @tool call (for streaming UIs)
_FIRST_TOOL_SIGNAL_SENT = False
_EMITTED_TOOL_NAMES: Optional[set] = None

def _maybe_signal_first_tool_call() -> None:
    """Emit a single stdout marker when any @tool is first invoked.

    Guarded by env var EVIDENCE_STREAM_MARKERS to avoid corrupting non-stream JSON outputs.
    """
    global _FIRST_TOOL_SIGNAL_SENT
    if _FIRST_TOOL_SIGNAL_SENT:
        return
    if os.getenv("EVIDENCE_STREAM_MARKERS"):
        try:
            print("AGENT_TOOL_CALLED", flush=True)
        except Exception:
            pass
    _FIRST_TOOL_SIGNAL_SENT = True

def _emit_tool_name(name: str) -> None:
    """Emit a single stdout line per tool name when markers are enabled.

    Prints: TOOL_CALLED:<name>
    """
    if not os.getenv("EVIDENCE_STREAM_MARKERS"):
        return
    global _EMITTED_TOOL_NAMES
    if _EMITTED_TOOL_NAMES is None:
        _EMITTED_TOOL_NAMES = set()
    if name in _EMITTED_TOOL_NAMES:
        return
    try:
        print(f"TOOL_CALLED:{name}", flush=True)
    except Exception:
        pass
    _EMITTED_TOOL_NAMES.add(name)


@tool("extract_dates")
def extract_dates(text: str) -> List[str]:
    """Extract plausible dates from the provided text and return as ISO strings (YYYY-MM-DD).

    Heuristics only; may return multiple candidates. Prefer dates labeled like
    "Report Date", "Effective", or near words like "dated". The agent can choose.
    """
    _maybe_signal_first_tool_call()
    write_debug("extract_dates_input", {"text_head": text[:1000] if text else "", "length": len(text or "")})
    if not text:
        return []
    found: List[str] = []
    # Collect MM-DD-YYYY and YYYY-MM-DD and MonthName formats.
    for m in re.finditer(r"\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b", text):
        dt = _to_date_safe(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        if dt:
            found.append(_iso_date(dt))
    for m in re.finditer(r"\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b", text):
        dt = _to_date_safe(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        if dt:
            found.append(_iso_date(dt))
    for m in re.finditer(r"\b([A-Za-z]{3,9})\s+(\d{1,2}),\s*(\d{4})\b", text):
        mon = _MONTHS.get(m.group(1).lower())
        if mon:
            dt = _to_date_safe(int(m.group(3)), mon, int(m.group(2)))
            if dt:
                found.append(_iso_date(dt))

    # Deduplicate, preserve order
    seen = set()
    uniq: List[str] = []
    for d in found:
        if d not in seen:
            uniq.append(d)
            seen.add(d)
    write_debug("extract_dates_output", {"dates": uniq, "count": len(uniq)})
    return uniq


@tool("check_date_range")
def check_date_range(date_str: str, start: str, end: str) -> Dict[str, Any]:
    """Check if a given date is within [start, end], inclusive.

    Args:
      date_str: A raw date string (any common format) or an ISO date.
      start: ISO date boundary (YYYY-MM-DD) or ISO datetime.
      end: ISO date boundary (YYYY-MM-DD) or ISO datetime.

    Returns a dict: {"within": bool, "parsed_date": "YYYY-MM-DD"|None, "reason": str}
    """
    _maybe_signal_first_tool_call()
    parsed = _parse_any_date(date_str)
    if not parsed:
        result = {"within": False, "parsed_date": None, "reason": "unrecognized date format"}
        write_debug("check_date_range", {"input": {"date_str": date_str, "start": start, "end": end}, "result": result})
        return result

    def _parse_boundary(x: str) -> Optional[date]:
        try:
            return datetime.fromisoformat(x.replace("Z", "")).date()
        except Exception:
            return _parse_any_date(x)

    s = _parse_boundary(start)
    e = _parse_boundary(end)
    if not s or not e:
        result = {"within": False, "parsed_date": _iso_date(parsed), "reason": "invalid range"}
        write_debug("check_date_range", {"input": {"date_str": date_str, "start": start, "end": end}, "result": result})
        return result

    ok = s <= parsed <= e
    result = {
        "within": ok,
        "parsed_date": _iso_date(parsed),
        "reason": "in range" if ok else "out of range",
    }
    write_debug("check_date_range", {"input": {"date_str": date_str, "start": start, "end": end}, "result": result})
    return result


def _collapse_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s or "").strip()


_SPECS_CACHE: Optional[List[Dict[str, str]]] = None
_SPECS_CACHE_AT: Optional[float] = None
_SPECS_TTL_SEC = 15 * 60


def _http_get(url: str, headers: Dict[str, str], timeout: int = 5) -> Optional[str]:
    try:
        import urllib.request  # stdlib
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec - controlled URL
            return resp.read().decode("utf-8", errors="ignore")
    except Exception:
        return None


def _http_post_json(url: str, payload: Dict[str, Any], headers: Dict[str, str], timeout: int = 5) -> Optional[str]:
    try:
        import urllib.request
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json", **headers})
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec
            return resp.read().decode("utf-8", errors="ignore")
    except Exception:
        return None


def _load_specs_from_supabase() -> Optional[List[Dict[str, str]]]:
    base = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_KEY")
    if not base or not key:
        write_debug("get_control_specs_env_missing", {"SUPABASE_URL": bool(os.getenv("SUPABASE_URL")), "NEXT_PUBLIC_SUPABASE_URL": bool(os.getenv("NEXT_PUBLIC_SUPABASE_URL")), "SUPABASE_SERVICE_KEY": bool(key)})
        return None
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
    }
    # Preferred: dedicated view `control_specs` with id, control_id, specification
    url = f"{base}/rest/v1/control_specs?select=id,control_id,specification&limit=10000"
    text = _http_get(url, headers)
    data: Optional[List[Dict[str, Any]]] = None
    if text:
        try:
            data = json.loads(text)
        except Exception:
            data = None
    if not data:
        # Fallback: RPC `get_all_control_specs` returning rows [{id, control_id, specification}]
        rpc_url = f"{base}/rest/v1/rpc/get_all_control_specs"
        text = _http_post_json(rpc_url, {}, headers)
        if text:
            try:
                data = json.loads(text)
            except Exception:
                data = None
    if not data or not isinstance(data, list):
        return None
    out: List[Dict[str, str]] = []
    for row in data:
        cid = str(row.get("control_id", ""))
        spec = _collapse_ws(str(row.get("specification", "")))
        rid = str(row.get("id", ""))
        if cid and spec:
            out.append({"id": rid, "control_id": cid, "specification": spec})
    write_debug("get_control_specs_supabase", {"count": len(out)})
    return out


def _load_specs_local_fallback() -> Optional[List[Dict[str, str]]]:
    # Optional local file for offline dev: db/control_specs.json
    sample_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "db", "control_specs.json")
    try:
        with open(sample_path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            out: List[Dict[str, str]] = []
            for row in data:
                cid = str(row.get("control_id", ""))
                spec = _collapse_ws(str(row.get("specification", "")))
                rid = str(row.get("id", ""))
                if cid and spec:
                    out.append({"id": rid, "control_id": cid, "specification": spec})
            write_debug("get_control_specs_local", {"count": len(out)})
            return out
    except Exception:
        return None
    return None


def _get_control_specs_cached() -> List[Dict[str, str]]:
    import time
    global _SPECS_CACHE, _SPECS_CACHE_AT
    now = time.time()
    if _SPECS_CACHE and _SPECS_CACHE_AT and (now - _SPECS_CACHE_AT) < _SPECS_TTL_SEC:
        return _SPECS_CACHE
    specs = _load_specs_from_supabase() or _load_specs_local_fallback() or []
    _SPECS_CACHE, _SPECS_CACHE_AT = specs, now
    return specs


@tool("get_control_specs")
def get_control_specs() -> List[Dict[str, str]]:
    """Return all control specifications as a list of {id, control_id, specification}.

    Fetches from Supabase (REST) if configured; falls back to a local JSON file db/control_specs.json.
    Results are cached in-memory for 15 minutes to avoid repeated DB hits.
    """
    _maybe_signal_first_tool_call()
    return _get_control_specs_cached()


# --- LLM-assisted date extraction -------------------------------------------------------------

def _llm_extract_date_core(text: str) -> Dict[str, Any]:
    """Use an LLM to extract exactly one evidence date from text.

    Returns dict with keys: {date: 'YYYY-MM-DD'|None, quote: str, reason: str}.
    Applies post-validation to ensure the quote appears in the text and to normalize the date.
    """
    llm = get_default_llm()
    system = (
        "You extract a single date from provided text.\n"
        "Instructions:\n"
        "- Extract exactly one date from the text.\n"
        "- Put it in the format YYYY-MM-DD.\n"
        "- If there is no clear date, return null.\n"
        "Output: strict JSON only with a single key named 'date' whose value is YYYY-MM-DD or null. No extra text."
    )
    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
    ])
    # Bound text length for LLM
    bounded = text[:200_000]
    user = HumanMessage(content=(
        "extract exactly one date from this text:\n" + bounded + "\n\n" +
        "put it in the format of YYYY-MM-DD and return strict JSON only with a single key named 'date' whose value is YYYY-MM-DD or null."
    ))
    try:
        # Call the LLM directly (no agent state), to get a plain content string
        messages = prompt.format_messages()
        messages.append(user)
        resp = llm.invoke(messages)
        content = getattr(resp, "content", "")
    except Exception as e:
        write_debug("llm_extract_date_error", {"error": str(e)})
        return {"date": None, "quote": "", "reason": f"llm_error: {e}"}

    # Parse model content: try JSON first, else accept a plain string date
    date_str = None
    quote = ""
    reason = ""
    txt = content.strip() if isinstance(content, str) else str(content)
    try:
        obj = json.loads(txt)
        if isinstance(obj, dict):
            date_str = obj.get("date")
            quote = str(obj.get("quote", ""))
            reason = str(obj.get("reason", "")) or "json_result"
        elif isinstance(obj, str):
            date_str = obj
            reason = "string_in_json"
        else:
            reason = "unexpected_json_type"
    except Exception:
        # Not JSON – try treat as a plain date string
        date_str = txt
        reason = "string_result"

    # Validate quote is present
    if quote and quote not in bounded:
        return {"date": None, "quote": "", "reason": "quote_not_in_text"}

    # Normalize/parse date
    iso: Optional[str] = None
    if date_str:
        d = _parse_any_date(str(date_str))
        if d:
            iso = _iso_date(d)
    # If date missing but quote present, try parse from quote
    if not iso and quote:
        d = _parse_any_date(quote)
        if d:
            iso = _iso_date(d)

    return {"date": iso, "quote": quote, "reason": reason}


@tool("llm_extract_date")
def llm_extract_date(text: str) -> Dict[str, Any]:
    """LLM-based date extraction. Returns {date, quote, reason}."""
    _maybe_signal_first_tool_call()
    write_debug("llm_extract_date_input", {"text_len": len(text or "")})
    out = _llm_extract_date_core(text)
    write_debug("llm_extract_date_output", out)
    return out


# --- Agent builders ---------------------------------------------------------------------------

ChatPromptTemplate = _import_prompt()
create_react_agent = _import_react_agent()
ChatOpenAI = _import_openai_llm()
HumanMessage = _import_messages()
SystemMessage = _import_system_message()


def get_default_llm(model: str = "gpt-4o-mini", temperature: float = 0.0):
    """Return a default chat LLM. Requires OPENAI_API_KEY to be set for ChatOpenAI."""
    return ChatOpenAI(model=model, temperature=temperature)


def _stringify_agent_output(out: Any) -> str:
    """Best-effort to coerce agent outputs into a plain string."""
    try:
        # Direct string
        if isinstance(out, str):
            return out
        # LangChain Message with content
        content = getattr(out, "content", None)
        if isinstance(content, str):
            return content
        # Dict with messages list
        if isinstance(out, dict) and "messages" in out:
            msgs = out.get("messages") or []
            parts: List[str] = []
            for m in msgs:
                c = getattr(m, "content", None)
                if isinstance(c, str):
                    parts.append(c)
                elif isinstance(m, dict) and isinstance(m.get("content"), str):
                    parts.append(m.get("content"))
            if parts:
                return "\n".join(parts)
        # Fallback JSON dump for simple objects
        return json.dumps(out, default=str)
    except Exception:
        return str(out)


def _extract_json_object(text: str) -> Optional[Dict[str, Any]]:
    """Try to robustly extract a JSON object from model text.

    - Strips markdown code fences (```json ... ``` or ``` ... ```)
    - Attempts direct json.loads
    - As a last resort, finds the first '{' and last '}' and parses that slice
    Returns dict on success, else None.
    """
    if text is None:
        return None
    s = text.strip()
    # Strip code fences
    if s.startswith("```"):
        s = s.strip('`')
        # remove optional leading language label like json\n
        # After stripping backticks, remove leading 'json' token if present
        if s.lower().startswith("json\n"):
            s = s[5:]
    # Try direct parse
    try:
        obj = json.loads(s)
        if isinstance(obj, dict):
            return obj
    except Exception:
        pass
    # Try slice between first '{' and last '}'
    try:
        start = s.find('{')
        end = s.rfind('}')
        if start != -1 and end != -1 and end > start:
            obj = json.loads(s[start:end+1])
            if isinstance(obj, dict):
                return obj
    except Exception:
        pass
    return None


def build_date_guard_agent(llm=None):
    """Construct the Date Guard sub-agent.

    Input expectations for invoke(): a dict with keys:
      - text: evidence text
      - date_start: ISO date or datetime string
      - date_end: ISO date or datetime string

    Output: JSON string strictly with keys {status, parsed_date, reason}.
    """
    if llm is None:
        llm = get_default_llm()

    prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You are the Date Guard. Determine if the evidence date lies within the given window.\n"
            "Use tools to extract plausible dates and check the range.\n"
            "If multiple dates exist, choose the one that denotes the evidence date (e.g., 'Report Date', 'Effective on').\n"
            "Return a strict JSON object with keys: status (PASS|FAIL), parsed_date (YYYY-MM-DD or null), reason."
        )),
    ])

    tools = [llm_extract_date, check_date_range]
    return create_react_agent(llm, tools=tools, prompt=prompt)


def build_action_describer_agent(llm=None):
    """Construct the Action Describer sub-agent.

    Input for invoke(): {text}
    Output: a concise paragraph (<=120 words) describing actions performed or required.
    """
    if llm is None:
        llm = get_default_llm()

    prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You write concise, neutral summaries. In 120 words or fewer, describe the actions the document prescribes or records.\n"
            "No extra commentary, no speculation, avoid boilerplate."
        )),
    ])

    # No tools required for this agent per plan.
    return create_react_agent(llm, tools=[], prompt=prompt)


def build_control_assigner_agent(llm=None):
    """Construct the Control Assigner sub-agent.

    Input for invoke(): {text}
    Output: strict JSON {control_id: string|null, id: string|null, rationale: string}
    """
    if llm is None:
        llm = get_default_llm()

    prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You must pick exactly one control based solely on control specifications.\n"
            "First, call get_control_specs() to retrieve ALL available controls as fields: id, control_id, specification.\n"
            "Then, given the evidence text, choose the single best-matching control_id.\n"
            "Return strict JSON with keys: control_id, id, rationale. Always choose exactly one."
        )),
    ])

    tools = [get_control_specs]
    return create_react_agent(llm, tools=tools, prompt=prompt)


# --- Convenience runners (optional) -----------------------------------------------------------

def run_date_guard(text: str, date_start: str, date_end: str, llm=None) -> str:
    """Invoke Date Guard and return its final JSON string."""
    agent = build_date_guard_agent(llm)
    write_debug("date_guard_invoke_input", {"text_len": len(text or ""), "date_start": date_start, "date_end": date_end})
    user = HumanMessage(content=(
        f"Evidence text:\n{text}\n\n"
        f"Date window:\nstart={date_start}\nend={date_end}\n\n"
        "Think step-by-step, use tools as needed, then return the final JSON only."
    ))
    out = agent.invoke({"messages": [user]})
    write_debug("date_guard_invoke_output", {"raw": out})
    return out


def _action_describer_core(text: str) -> str:
    """Direct LLM call to summarize actions in <=120 words; returns plain text."""
    llm = get_default_llm()
    sys_msg = SystemMessage(content=(
        "You write concise, neutral summaries. In 120 words or fewer, describe the actions the document prescribes or records. "
        "No extra commentary, no speculation, avoid boilerplate. Output only the summary text."
    ))
    user = HumanMessage(content=(f"Document text:\n{text}"))
    try:
        resp = llm.invoke([sys_msg, user])
        content = getattr(resp, "content", "")
        return content if isinstance(content, str) else str(content)
    except Exception as e:
        write_debug("action_describer_core_error", {"error": str(e)})
        return ""


def run_action_describer(text: str, llm=None) -> str:
    """Return actions summary string (<=120 words)."""
    write_debug("action_describer_input", {"text_len": len(text or "")})
    summary = _action_describer_core(text)
    write_debug("action_describer_output", {"summary": summary})
    return summary


def _control_assigner_core(text: str) -> Dict[str, Any]:
    """Direct LLM call to choose exactly one control from specs using only evidence text.

    Returns a dict {control_id, id, rationale}."""
    llm = get_default_llm()
    specs = _get_control_specs_cached()
    # Build a compact listing to stay within context limits
    lines: List[str] = []
    id_to_code: Dict[str, str] = {}
    code_to_id: Dict[str, str] = {}
    for row in specs:
        cid = row.get("control_id", "")
        rid = row.get("id", "")
        spec = _collapse_ws(row.get("specification", ""))[:400]
        if cid and spec:
            # pipe-delimited to keep it tight
            lines.append(f"{rid}|{cid}|{spec}")
            if rid:
                id_to_code[rid] = cid
            if cid and rid:
                code_to_id[cid] = rid
    catalog = "\n".join(lines)

    sys_msg = SystemMessage(content=(
        "You must pick exactly one control based only on the given control specifications.\n"
        "Choose strictly from the catalog provided (do not invent new codes).\n"
        "If uncertain, return null.\n"
        "Return strict JSON only with keys: control_id, id, rationale (<=30 words)."
    ))
    # Bound evidence length
    ev = (text or "")
    if len(ev) > 5000:
        ev = ev[:5000]
    user = HumanMessage(content=(
        "Evidence:\n" + ev + "\n\n" +
        "Control specifications (id|control_id|specification):\n" + catalog + "\n\n" +
        "Respond with JSON only."
    ))
    write_debug("control_assigner_core_input", {"evidence_len": len(ev), "specs_count": len(specs), "catalog_len": len(catalog)})
    try:
        resp = llm.invoke([sys_msg, user])
        content = getattr(resp, "content", "")
        txt = content if isinstance(content, str) else str(content)
        obj = _extract_json_object(txt)
        if obj is None:
            write_debug("control_assigner_core_nonjson", {"raw": txt[:800]})
            # Retry once with an explicit JSON-only instruction
            retry_sys = SystemMessage(content=(
                "Respond with JSON only. No prose, no code fences. Keys: control_id, id, rationale."
            ))
            resp2 = llm.invoke([retry_sys, user])
            txt2 = getattr(resp2, "content", "")
            if not isinstance(txt2, str):
                txt2 = str(txt2)
            obj = _extract_json_object(txt2)
            if obj is None:
                raise ValueError("non_json_output")
        # Normalize keys
        ctrl_id = obj.get("control_id")
        rid = obj.get("id")
        rationale = obj.get("rationale", "")

        # Fill missing via mapping if possible
        if rid and not ctrl_id and rid in id_to_code:
            ctrl_id = id_to_code[rid]
        if ctrl_id and not rid and ctrl_id in code_to_id:
            rid = code_to_id[ctrl_id]

        # Validate membership
        valid = False
        if rid and rid in id_to_code:
            valid = True
        elif ctrl_id and ctrl_id in code_to_id:
            valid = True

        if not valid:
            write_debug("control_assigner_invalid_choice", {"proposed_control_id": ctrl_id, "proposed_id": rid})
            return {"control_id": None, "id": None, "rationale": "not_in_catalog"}

        return {"control_id": ctrl_id, "id": rid, "rationale": rationale}
    except Exception as e:
        write_debug("control_assigner_core_error", {"error": str(e)})
        return {"control_id": None, "id": None, "rationale": f"error: {e}"}


def run_control_assigner(text: str, llm=None) -> str:
    """Choose a control using only evidence text and return JSON string."""
    write_debug("control_assigner_input", {"text_len": len(text or "")})
    obj = _control_assigner_core(text)
    write_debug("control_assigner_output", obj)
    return json.dumps(obj)


__all__ = [
    "extract_dates",
    "check_date_range",
    "get_control_specs",
    "build_date_guard_agent",
    "build_action_describer_agent",
    "build_control_assigner_agent",
    "run_date_guard",
    "run_action_describer",
    "run_control_assigner",
]

# --- Sub-agents as tools (Step 4) -------------------------------------------------------------


@tool("date_guard")
def date_guard_tool(text: str, date_start: str, date_end: str) -> str:
    """Validate the evidence date within range using an LLM-assisted pipeline.

    Returns strict JSON: {status: PASS|FAIL, parsed_date: YYYY-MM-DD|null, reason: string}
    """
    _maybe_signal_first_tool_call()
    _emit_tool_name("date_guard")
    result = date_guard_pipeline(text=text, date_start=date_start, date_end=date_end)
    return json.dumps(result)


@tool("action_describer")
def action_describer_tool(text: str) -> str:
    """Run the Action Describer sub-agent and return JSON: {actions_summary}."""
    _maybe_signal_first_tool_call()
    _emit_tool_name("action_describer")
    out = run_action_describer(text=text)
    # Ensure compact JSON string
    if isinstance(out, dict):
        return json.dumps({"actions_summary": out.get("actions_summary", "")})
    return json.dumps({"actions_summary": str(out)})


@tool("control_assigner")
def control_assigner_tool(text: str) -> str:
    """Run the Control Assigner sub-agent on evidence text and return JSON: {control_id, id, rationale}."""
    _maybe_signal_first_tool_call()
    _emit_tool_name("control_assigner")
    out = run_control_assigner(text=text)
    try:
        obj = out if isinstance(out, dict) else json.loads(str(out))
    except Exception:
        obj = {"control_id": None, "id": None, "rationale": f"non-json: {str(out)[:200]}"}
    return json.dumps(obj)


# --- Supervisor Agent (Step 5) ----------------------------------------------------------------

def build_supervisor_agent(llm=None):
    """Create the supervisor that orchestrates the three sub-agents as tools.

    Tools available:
      - date_guard(text, date_start, date_end)
      - action_describer(text)
      - control_assigner(text)

    Contract: The supervisor must follow this exact sequence:
      1) Call date_guard first. If status=FAIL, return final JSON with failure.
      2) If PASS, call action_describer with text.
      3) Then call control_assigner with text.
      4) Return final JSON:
         {
           "date_check": {status, parsed_date, reason},
           "actions_summary": "...",
           "assigned_control_id": "..." | null,
           "rationale": "..."
         }
    """
    if llm is None:
        llm = get_default_llm()

    prompt = ChatPromptTemplate.from_messages([
        ("system", (
            "You are the supervisor that coordinates specialized tools in a fixed sequence.\n"
            "Always follow this order: 1) date_guard -> 2) control_assigner.\n"
            "- Use date_guard(text, date_start, date_end) and parse its JSON output.\n"
            "- If its status is FAIL, immediately return the final JSON with that failure.\n"
            "- If PASS, call control_assigner(text) and parse the fields control_id and rationale.\n"
            "Finally, return a strict JSON object with exactly these keys: date_check, actions_summary, assigned_control_id, rationale."
        )),
    ])

    tools = [date_guard_tool, control_assigner_tool]
    return create_react_agent(get_default_llm() if llm is None else llm, tools=tools, prompt=prompt)


def run_supervisor(text: str, date_start: str, date_end: str, llm=None) -> Dict[str, Any]:
    """Deterministic supervisor orchestration using the new LLM date extractor.

    Steps:
      1) Date Guard pipeline (llm_extract_date + range check)
      2) If PASS → Action Describer sub-agent → summary string
      3) Control Assigner sub-agent with full specifications
    Returns strict JSON with keys: date_check, actions_summary, assigned_control_id, rationale
    """
    write_debug("supervisor_orchestrator_input", {"text_len": len(text or ""), "date_start": date_start, "date_end": date_end})
    # Emit progress markers aligned with the conceptual tool stages
    _maybe_signal_first_tool_call()
    _emit_tool_name("date_guard")

    # Step 1: Date Guard pipeline
    date_check = date_guard_pipeline(text=text, date_start=date_start, date_end=date_end)
    if date_check.get("status") != "PASS":
        result: Dict[str, Any] = {
            "date_check": date_check,
            "actions_summary": "",
            "assigned_control_id": None,
            "rationale": "date check failed",
        }
        write_debug("supervisor_orchestrator_output", result)
        return result

    # Step 2: Bypass Action Describer — derive a concise snippet from the input text
    _emit_tool_name("action_describer")
    def _make_actions_snippet(s: str, max_chars: int = 600) -> str:
        body = re.sub(r"\s+", " ", s or "").strip()
        if len(body) <= max_chars:
            return body
        # Prefer cutting on sentence boundary before max_chars
        cut = body.rfind('. ', 0, max_chars)
        if cut == -1:
            cut = max_chars
        return body[:cut].strip()

    actions_summary = _make_actions_snippet(text)
    write_debug("actions_summary_bypass", {"len": len(actions_summary), "preview": actions_summary[:300]})

    # Step 3: Control Assigner using evidence text only
    _emit_tool_name("control_assigner")
    assign_out = run_control_assigner(text=text, llm=llm)
    try:
        assign_obj = assign_out if isinstance(assign_out, dict) else json.loads(str(assign_out))
    except Exception:
        assign_obj = {"control_id": None, "rationale": f"non-json: {str(assign_out)[:200]}"}

    result = {
        "date_check": date_check,
        "assigned_control_id": assign_obj.get("control_id"),
        "rationale": assign_obj.get("rationale", ""),
    }
    write_debug("supervisor_orchestrator_output", result)
    return result


# --- Date Guard pipeline (deterministic orchestration) ---------------------------------------

def date_guard_pipeline(text: str, date_start: str, date_end: str) -> Dict[str, Any]:
    """Run LLM-based extraction followed by deterministic range check.

    - Extract date via llm_extract_date; if null, fallback to regex extraction (first candidate).
    - Validate within [date_start, date_end] using check_date_range.
    - Return {status, parsed_date, reason}.
    """
    write_debug("date_guard_pipeline_input", {"text_len": len(text or ""), "date_start": date_start, "date_end": date_end})
    extracted = _llm_extract_date_core(text)
    parsed_date = extracted.get("date")
    reason_parts = [f"llm: {extracted.get('reason','')}".strip()]

    if not parsed_date:
        result = {"status": "FAIL", "parsed_date": None, "reason": "; ".join([p for p in reason_parts if p]) or "no date extracted"}
        write_debug("date_guard_pipeline_output", result)
        return result

    # Range check
    r = check_date_range.func(parsed_date, date_start, date_end)  # call underlying function
    status = "PASS" if r.get("within") else "FAIL"
    reason_parts.append(f"range: {r.get('reason')}")
    result = {"status": status, "parsed_date": r.get("parsed_date"), "reason": "; ".join([p for p in reason_parts if p])}
    write_debug("date_guard_pipeline_output", result)
    return result


__all__ += [
    "date_guard_tool",
    "action_describer_tool",
    "control_assigner_tool",
    "build_supervisor_agent",
    "run_supervisor",
]
