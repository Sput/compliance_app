"""
CLI wrapper to run the supervisor agent over provided text and date window.

Usage:
  python -m python-scripts.supervisor_cli --text <TEXT> --date_start YYYY-MM-DD --date_end YYYY-MM-DD

Prints a strict JSON result to stdout.
"""
from __future__ import annotations
import argparse
import json
import sys
from typing import Any

def _import_agents():
    # Support running as a script (no package context)
    try:
        from .evidence_process_agents import run_supervisor  # type: ignore
        from .debug_io import write_debug  # type: ignore
        return run_supervisor, write_debug
    except Exception:
        pass
    try:
        import os, sys
        here = os.path.dirname(__file__)
        if here not in sys.path:
            sys.path.insert(0, here)
        from evidence_process_agents import run_supervisor  # type: ignore
        try:
            from debug_io import write_debug  # type: ignore
        except Exception:
            def write_debug(tag: str, payload: Any) -> None:  # type: ignore
                pass
        return run_supervisor, write_debug
    except Exception as e:  # pragma: no cover
        print(json.dumps({"success": False, "error": f"import_error: {e}"}))
        sys.exit(1)


def main() -> None:
    run_supervisor, write_debug = _import_agents()
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=False, help="Decoded UTF-8 document text")
    parser.add_argument("--text_file", required=False, help="Path to file containing UTF-8 text")
    parser.add_argument("--date_start", required=True, help="Audit window start (YYYY-MM-DD)")
    parser.add_argument("--date_end", required=True, help="Audit window end (YYYY-MM-DD)")
    args = parser.parse_args()

    write_debug("supervisor_cli_args", {"has_text": bool(args.text), "text_file": bool(args.text_file), "date_start": args.date_start, "date_end": args.date_end})

    if args.text_file:
        try:
            with open(args.text_file, 'r', encoding='utf-8', errors='ignore') as f:
                text = f.read()
        except Exception as e:
            print(json.dumps({"success": False, "error": f"read_text_file_error: {e}"}))
            sys.exit(1)
    else:
        if not args.text:
            print(json.dumps({"success": False, "error": "missing --text or --text_file"}))
            sys.exit(1)
        text = args.text
    # Bound text size for safety in case caller forgot to truncate
    if len(text) > 200_000:
        text = text[:200_000]

    try:
        write_debug("supervisor_cli_input", {"text_len": len(text or ""), "date_start": args.date_start, "date_end": args.date_end})
        out = run_supervisor(text=text, date_start=args.date_start, date_end=args.date_end)
        # Ensure JSON on stdout
        if isinstance(out, (dict, list)):
            write_debug("supervisor_cli_output", out)
            print(json.dumps(out))
        else:
            # String produced by run_supervisor should already be JSON
            write_debug("supervisor_cli_output", {"raw": out})
            print(out)
    except Exception as e:
        write_debug("supervisor_cli_error", {"error": str(e)})
        print(json.dumps({"success": False, "error": f"supervisor_error: {e}"}))
        sys.exit(2)


if __name__ == "__main__":
    main()
