# Human-in-the-Loop Evidence Review with Agentic Architecture

Collecting audit evidence is only half the job—the other half is deciding whether each artifact actually satisfies a control. This post explains how the app’s agentic architecture supports a clean, auditable review workflow where reviewers accept or reject evidence with confidence.

## Why Agentic for Reviews

- Trust but verify: Agents provide structured recommendations; humans make final calls.
- Repeatable decisions: Agents produce consistent, explainable artifacts (date checks, summaries, rationales) that anchor reviewer judgment.
- Scale gracefully: Deterministic gates catch obvious issues; LLM agents add higher recall for ambiguous cases.

## Review States (MVP+)

- Uploaded → Processing → Classified → Needs Review → Accepted or Rejected
- Optional: Auto‑accept if high confidence and policy allows; else route to Needs Review.

## The Three Specialist Sub‑Agents

- Date Guard: Extracts a single evidence date and verifies it’s within the audit window.
  - Tools: `extract_dates`, `check_date_range`
  - Output: `{ status: PASS|FAIL, parsed_date, reason }`
- Action Describer: Summarizes what the document shows (≤120 words).
  - Output: `{ actions_summary }`
- Control Assigner: Picks the best matching control and provides rationale.
  - Tools: `get_control_specs` (from DB or local fallback)
  - Output: `{ control_id, id, rationale }`

Repo entry points:

- `python-scripts/evidence_process_agents.py` — sub‑agents, tools, and supervisor orchestration
- `python-scripts/supervisor_cli.py` — CLI wrapper for supervisor

## Supervisor Orchestration

- Sequence: Date Guard → (if PASS) Control Assigner (and optional Action Describer)
- Contracted output:
  - `date_check`: gate for acceptance eligibility
  - `assigned_control_id`: agent’s best match
  - `rationale`: short reasoning for the selection
- Implementation detail: The current `run_supervisor` uses a concise text snippet for actions; you can swap to the Action Describer sub‑agent when ready.

## Decision Flow for Accept/Reject

1) Automated Gate (Date Guard)
   - If `status=FAIL`, mark as `Rejected` with reason `date check failed`.
   - If `status=PASS`, continue.

2) Agent Recommendation (Control Assigner)
   - Returns `assigned_control_id` plus `rationale` and can be combined with confidence heuristics.

3) Human Review (Needs Review)
   - UI shows:
     - Extracted date status and parsed date
     - Actions summary (snippet or sub‑agent output)
     - Candidate control and rationale (with link to the full specification)
     - Raw text excerpt for context
   - Reviewer actions:
     - Accept: persist `review_status=accepted`, chosen `control_id`, `reviewed_by`, `reviewed_at`, and `rationale`
     - Reject: set `review_status=rejected` with a `reject_reason` (e.g., wrong control, outdated evidence)
     - Request changes (optional): assign back to uploader with a note

4) Optional Auto‑Accept Policy
   - Example rule: If Date Guard = PASS and Control Assigner matches an allow‑list and confidence ≥ threshold, auto‑accept with an automated rationale and flag for spot‑check.

## Data Model Touchpoints

- Evidence row fields (illustrative; see `schema.sql`):
  - `extracted_text` (truncated), `system`, `evidence_date`
  - `classifications` (JSON array) and/or `assigned_control_id`
  - `review_status` (`needs_review`|`accepted`|`rejected`)
  - `reviewed_by`, `reviewed_at`, `review_rationale` (accept) or `reject_reason`
  - Optional `selected_index` to indicate which candidate was accepted

## Implementation Map (Repo)

- API boundary: `src/app/api/evidence/process/route.ts` calls `python-scripts/supervisor_cli.py` with text + date window and returns structured JSON.
- Sub‑agents and tools: `python-scripts/evidence_process_agents.py`
  - `date_guard_pipeline` (LLM extraction → deterministic range check)
  - `get_control_specs` (Supabase REST or local JSON fallback)
  - `run_control_assigner` (LLM picks from catalog; enforces membership)
- Service mode: `python-scripts/service/app.py` exposes `/process-evidence` for deployment behind an internal network.

## Observability & Guardrails

- Deterministic where it matters: Date range checks are non‑LLM and fully explainable.
- JSON‑only contracts: Agents are wrapped to emit strict JSON for predictable parsing.
- Debug I/O: `write_debug` traces each tool/agent step, aiding audits and RCA.
- Safety limits: Input size bounds and fallback parsing keep the system responsive.

## How to Enable Full Review UX

- Add a reviewer UI panel in Next.js to display supervisor output alongside the original artifact.
- Implement POST endpoints to persist Accept/Reject decisions and rationale.
- Extend `schema.sql` with review‑specific columns if not already present.
- Optionally wire a feature flag (e.g., `USE_AGENT_REVIEW`) to toggle the agentic path.

## Roadmap

- Add multi‑control assignments (and partial acceptance) where a single artifact satisfies multiple controls.
- Confidence calibration via embeddings or retrieval‑augmented specs.
- Reviewer assistance prompts: “why not control X?” or “show similar accepted artifacts.”
- Storage webhooks to auto‑enqueue processing on new uploads.

—

Agents accelerate the grind but keep reviewers in control. By combining a deterministic gate, focused sub‑agents, and JSON‑first outputs, you get a transparent, repeatable review process that scales without sacrificing auditability.

