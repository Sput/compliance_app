# Classifying Compliance Evidence with Next.js, Python, and Supabase

Compliance audits are equal parts detective work and paperwork. Every audit requires collecting “evidence” — screenshots, reports, exports — that prove a control is implemented and operating as intended. Finding, uploading, and mapping each artifact to the right framework control (PCI, SOC 2, NIST, ISO, HIPAA, GDPR, etc.) is tedious and error‑prone.

This application turns that workflow into a fast, structured pipeline: upload an artifact → extract text (OCR) → parse key fields (system, date) → classify to relevant controls → store and surface the result. It’s intentionally small and pragmatic so teams can get value immediately and expand over time.

## What You Can Do Today (MVP)

- Upload evidence files (images, PDFs, or `.txt`).
- Automatically extract text and parse a likely system name and evidence date.
- Classify the artifact to one or more framework controls with confidence scores.
- Persist results in Postgres (via Supabase) and display them in the UI.
- Authenticate via Supabase Auth; store raw artifacts in a Supabase Storage bucket.

## Who It’s For

- Audit Leads: See incoming artifacts, their classifications, and status.
- Security Engineers: Upload evidence quickly and let the system pre‑map it to controls.

## How It Works

1) User uploads an artifact in the Next.js app.
2) The file is stored in Supabase Storage (or read locally during dev), and the app calls a Python processing service.
3) Python performs OCR, parses a date and system identifier, and classifies the artifact into framework controls.
4) Results are saved to Postgres and displayed in the app.

## Architecture at a Glance

- Frontend: Next.js (TypeScript/React) + shadcn/ui components (in `src/`).
- Auth & Storage: Supabase (Auth + Storage for evidence files).
- Database: Supabase Postgres for audits, evidence, classifications.
- Processing: Python scripts and a small FastAPI service (in `python-scripts/`).
- Bridge: Next.js API routes spawn the Python supervisor/CLI for local development, or call the FastAPI endpoint in service mode.

Key repo locations:

- `src/components/file-uploader.tsx` – drag‑and‑drop uploader with progress.
- `src/app/api/evidence/process/route.ts` – orchestrates processing by invoking the Python supervisor CLI.
- `python-scripts/service/app.py` – FastAPI endpoint (`/process-evidence`) for service deployment.
- `python-scripts/process_evidence.py` – CLI pipeline used during development.
- `python-scripts/modules/` – OCR, parsing, and classifier modules.
- `schema.sql` and `seeds/` – tables and seed data for frameworks/controls.

## The Processing Pipeline

- OCR: `modules/ocr.py` is provider‑agnostic; the dev stub reads `.txt` directly and returns a placeholder for other types. In production, plug in Tesseract or a managed OCR API.
- Parsing: `modules/parsing.py` finds a likely system identifier and an evidence date using conservative regex heuristics.
- Classification: `modules/classifier.py` assigns the artifact to candidate controls and returns confidence scores. The stub uses keyword heuristics and can be swapped for a semantic model later.

## Agentic Supervisor (Optional, Extensible)

The repo ships with an agent‑ready structure that breaks the task into three narrow “sub‑agents,” coordinated by a supervisor (see `python-scripts/supervisor_cli.py` and `agent_dev_plan.md`):

- Date Guard: Extract dates and verify the artifact’s date falls within the audit window.
- Action Describer: Summarize what the evidence shows in ≤120 words.
- Control Assigner: Select the best matching `controls.control_id` and provide rationale (using a short DB‑backed candidate list).

This is designed so you can start with deterministic rules, then progressively enable LLM agents for higher recall/precision where it matters, with good observability.

## Data Model (MVP Flavor)

- `audits`: basic audit records with `audit_start` and `audit_end` windows.
- `evidence`: one row per artifact, with file reference, extracted text (truncated for safety), parsed fields, and status.
- `classifications`: JSON array of candidates with `framework_id`, `control_id`, `control_code`, and `confidence`.

See `schema.sql` for details and `seeds/seeds.sql` for example frameworks/controls.

## Frontend Experience

- A simple uploader (drag‑and‑drop or click) with progress indicators.
- A results view showing classification candidates with confidence.
- Overview cards/graphs showcase how the UI scales (see `src/features/overview/`).

## Operations & Configuration

- Environment variables:
  - Next.js (public): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
  - Python service (server‑side only): `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, optional `PYTHON_OCR_PROVIDER`.
- Storage: Create a Supabase Storage bucket named `evidence`; allow authenticated uploads.
- Local dev: The Next.js API route can spawn the Python CLI to process a file or a text payload. For service mode, run the FastAPI app and point the route to it.

## Why This Shape Works

- Start Simple: Deterministic heuristics get you to a working baseline without heavy dependencies.
- Clear Hand‑off: The frontend focuses on UX; Python owns OCR/parsing/classification; Supabase persists and secures data.
- Gradual Intelligence: Swap in real OCR, add embeddings or LLM agents where they help, keep the deterministic fallbacks for stability.

## Roadmap Ideas

- Reviewer workflow (approve/reject, comments, change requests).
- Coverage dashboards by framework/control, gaps, and aging.
- Evidence reuse across audits; de‑duplication and cross‑mapping.
- Webhooks from Storage for automatic processing upon upload.
- Pluggable OCR and classification models with provider configs.

## Getting Started (Dev)

1) Set Supabase environment variables for the Next.js app and Python service.
2) Create the `evidence` storage bucket and run `schema.sql` (and optionally `seeds/seeds.sql`).
3) Start the Next.js app. Upload a test file (`.txt` to see raw text extraction) and observe classifications.
4) Swap in real OCR or the agentic supervisor when you’re ready to raise quality.

—

If you’re exploring or customizing, start with `README.md` and `PRD.md` for context, then follow `agent_dev_plan.md` to enable the multi‑agent supervisor. The code is intentionally small and approachable, so you can adapt it to your control catalog, frameworks, and evidence standards.

