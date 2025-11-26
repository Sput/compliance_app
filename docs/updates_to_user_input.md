> Title: Building a Human‑in‑the‑Loop Evidence Pipeline in Next.js + Supabase + Python
  
  Overview
  We implemented a full Human‑in‑the‑Loop (HITL) evidence processing flow in a Next.js app backed by Supabase and a Python agent engine. The result is an auditable, stepwise review UX where agents
  propose values, humans edit/approve, and final results are persisted to the database.
  
  Architecture
  
  - Frontend (Next.js App Router):
      - HITL UI: multi-step flow (Ingest → Date → Summary → Candidates → Finalize).
      - Progress UI: lists evidence for an audit and resolves control UUIDs to codes.
  - Backend (Next.js Route Handlers):
      - /api/hitl/start: creates/fetches an evidence row, opens a session.
      - /api/hitl/run: runs one stage via Python engine.
      - /api/hitl/apply: merges edits, persists a step, advances session, writes final results.
      - /api/hitl/session: fetches session state.
      - /api/controls/resolve: maps control UUIDs to control_id/title via Supabase REST (service key fallback).
  - Python Agent Engine:
      - CLI subcommands: start, run-stage, apply-edits, summarize.
      - Agents: Date (extract+guard), Action Describer, Control Candidates (spec-overlap scoring + keyword fallback).
      - Deterministic I/O, strict JSON on stdout.
  
  Data Touchpoints
  
  - Evidence uploads: public.evidence_uploads(id, audit_id, file_name, file_content_base64, control, created_at).
  - Controls catalog: public.controls(id, control_id, title, specification).
  - HITL state: hitl_sessions, hitl_steps (session progress and audit trail).
  
  HITL Steps
  
  - Ingest Text Agent:
      - Drag-and-drop upload → OCR text → seed text once.
      - Human edits are preserved; Approve carries edited text to the next steps and final DB write.
  - Date Control Agent (combined):
      - Extracts evidence_date and validates it against the audit window (PASS/FAIL).
  - Action Describer Agent:
      - Proposes a concise summary; human can edit.
  - Control Candidates Agent:
      - Proposes candidates via spec-overlap scoring (normalized confidence) with a keyword fallback; user selects one.
  - Finalize Classification Agent:
      - Shows all decisions; Approve writes final results, then resets to a blank Ingest step for the next upload.
  
  Persistence & Finalize
  
  - We map selected control to UUID via:
      - selection.uuid if present, else public.controls lookup (exact + ilike), else Supabase REST with service key to avoid RLS issues.
  - We write the edited evidence text to evidence_uploads.file_content_base64 (UTF‑8 base64).
  - We do not overwrite evidence_uploads.created_at (upload timestamp).
  - We reset the HITL form post-finalize to speed up the next evidence cycle.
  
  Caret Stability & Edits Preservation
  Problem:
  
  - Controlled textareas + reseeding proposals triggered node remounts, causing the caret to jump or requiring re-clicking for each keystroke.
  
  Solution:
  
  - Uncontrolled textareas (defaultValue) with DOM refs, seeded only once per step.
  - Read DOM values on Approve (and sync state once at commit).
  - Remove programmatic focus/selection management (browsers handle caret best when nodes are stable).
  - One-time seed guards prevent overwriting during typing.
  - Combined with Approve path reading directly from refs/values so your edits persist exactly.
  
  Control Candidates Matching
  
  - Pull control specs via Supabase REST + service key; tokenize and score overlap with specification text; normalize confidence to ~0.5–0.99 and show top N.
  - Fallback keyword rules used when no specs are available.
  
  Progress Page
  
  - Filter by audit ID (defaults to a known debug UUID).
  - Show ID, file name, created_at, control (resolved to code), uploaded_by.
  - Truncate long IDs, resolve control UUIDs via a service-key-protected API.
  
  Notable Iterations
  
  - Removed redundant Select Control step; the choice is made in Candidates step.
  - Combined Extract Date and Date Guard into a single Date step with both proposal and status.
  - Corrected default audit behavior (no auto-create; use explicit default UUID).
  - Introduced structured logs in the finalize path for request → decision → DB writes.
  
  Lessons Learned
  
  - For text-heavy HITL flows, avoid re-render side effects while typing. Uncontrolled inputs with a “read-on-commit” pattern are the most robust for caret stability.
  - Seed proposals only once; never overwrite user edits mid-flight.
  - Keep final write paths decoupled: sessions/steps capture audit trail; evidence_uploads reflects durable outcomes (control UUID and edited text).
  - Add service-key REST fallbacks when you need to bypass RLS for read-only mapping.
  
  What’s Next
  
  - Add a “back” mechanism to revise previous steps with a clear audit trail.
  - Incorporate LLMs behind the existing stage API with strict JSON responses and validations.
  - Extend the Finalize to persist additional context (e.g., evidence_date in its own column if desired).
  
  If you want a code-oriented, annotated diff of the caret/seed guard changes or the finalize write-back path, I can extract those snippets with commentary.