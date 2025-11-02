
Product Requirements Document (PRD)

Repository: https://github.com/Sput/compliance_app  (current top-level shows src/, public/, python-scripts/, and config like package.json, next.config.ts, tsconfig.json, components.json, env.example.txt.)  ￼

⸻

1. Introduction

This application will be used to track and classify artifacts (evidence) submitted as part of compliance audits.
An artifact is any document, screenshot, or report demonstrating that an IT system meets specific compliance requirements (e.g., PCI DSS, SOC 2, NIST 800-53).

⸻

2. Objectives & Goals
	•	Enable users to upload evidence for audits.
	•	Automatically classify evidence against relevant compliance frameworks and controls using an agentic pipeline.
	•	Allow users to track progress of evidence collection.
	•	Enable reuse of evidence across multiple audits (e.g., applying one artifact to several controls/frameworks).

⸻

3. Target Users & Roles

Role	Description	Capabilities
Audit Lead	Conducts and manages audits.	Request evidence (future), review/approve (future), assign evidence to controls, monitor audit progress.
Security Engineer	Provides technical evidence for compliance.	Upload new artifacts, view classification results, reuse prior evidence (future).


⸻

4. Core Features (MVP)
	1.	Evidence Upload Form (in the existing React/Next.js app under src/)
	•	File input (PDF, images; DOCX optional if supported by OCR).
	•	Minimal metadata capture if needed (audit selection, optional notes).
	2.	Automatic Classification Agent (Python)
	•	After upload:
	•	OCR/validation to extract text and parse system and date.
	•	Classification to map artifact → framework control(s) + confidence.
	•	Store results in Postgres (Supabase).
	3.	Audit Dashboard (MVP-light)
	•	List uploaded evidence.
	•	Show classification: framework → control(s) → confidence.
	•	Basic status: Uploading → Processing → Classified.

⸻

5. Future Scope (not in MVP)
	•	Evidence review & approval (Audit Lead).
	•	Audit progress tracking (coverage by controls).
	•	Evidence reuse (link artifacts from prior audits).

⸻

6. User Journey (End-to-End Flow)
	1.	User logs in via Supabase Auth.
	2.	Navigates to an audit context (basic list/select for MVP).
	3.	Uploads a piece of evidence via the React form.
	4.	Backend (Python service) receives the job.
	5.	OCR/validation extracts text and parses system and date.
	6.	Classification determines relevant control(s) under a framework.
	7.	Results persisted in DB and displayed in the UI.

⸻

7. Technical Architecture (Repo-aware)

Layer	Technology	Notes / Repo alignment
Frontend	Next.js (TypeScript) + React + Shadcn/UI	Live under src/ with app components and UI; Shadcn config present via components.json.  ￼
Auth	Supabase Auth	Client session in the Next app; server-side verification for protected API calls.
Storage	Supabase Storage	Holds uploaded artifacts; browser uploads via signed URLs.
Business Logic	Python service	Lives (initially) in python-scripts/; promote to a small FastAPI/Flask app that handles OCR + classification and DB writes.  ￼
Database	PostgreSQL (Supabase)	Evidence, audits, classification results.
Config	env.example.txt, next.config.ts, package.json, tsconfig.json	Project-level settings and env hints exist in repo root.  ￼

Eventing options (choose one in implementation):
	•	Frontend uploads to Supabase Storage → calls Python API with file metadata → Python fetches via signed URL and processes.
	•	Or Supabase Storage webhook → notifies Python to process new objects.

⸻

8. Agentic Flow (Pipeline)

User Uploads Evidence (Next.js UI)
   ↓
Supabase Storage (file)
   ↓
Python Service (OCR → parse system/date → classify → confidence)
   ↓
Postgres (evidence row + classification JSON)
   ↓
Next.js UI (shows classification result & status)


⸻

9. Data Model

A) Operational (MVP)

Table: audits

Column	Type	Description
id	uuid (PK)	Unique audit ID
name	text	Audit name
framework	text	Display label (optional; classification references canonical tables below)

Table: evidence

Column	Type	Description
id	uuid (PK)	Evidence ID
audit_id	uuid (FK → audits.id)	Linked audit
file_url	text	Supabase Storage path
extracted_text	text	OCR output (optional)
system	text	Parsed system/service name
evidence_date	date	Parsed date
classification	jsonb	Classification result (see JSON shape below)
status	text	`uploaded
uploaded_by	uuid	Supabase user id
created_at	timestamptz	Default now()

Classification JSON (MVP) — references canonical IDs below

{
  "candidates": [
    {
      "framework_id": "<uuid>",        // → frameworks.id
      "framework_name": "PCI DSS",
      "framework_version": "4.0",
      "control_id": "<uuid>",          // → controls.id
      "control_code": "10.2.1",        // controls.control_id
      "mapping_id": "<uuid>",          // → mappings.id (optional if known)
      "confidence": 0.86
    }
  ],
  "selected_index": 0                  // optional: which candidate is “accepted” for MVP UI
}


⸻

B) Compliance Catalog (Canonical)

Table: frameworks
Stores compliance frameworks (canonical list the classifier maps to).

Column	Type	Description
id	uuid (PK)	Framework ID
name	text (UK with version)	e.g., PCI DSS, NIST 800-53
version	text	e.g., 4.0, rev 5
description	text	Optional
source_file	text	Optional import source
created_at	timestamptz	Default now()

Table: controls
Stores canonical controls (codes, titles, categories).

Column	Type	Description
id	uuid (PK)	Control row
control_id	text (UK)	Human-readable code, e.g., 10.2.1
title	text	Optional descriptive title
category	text	Optional grouping
created_at	timestamptz	Default now()

Table: mappings
Joins a control to a framework (the crosswalk the classifier ultimately points to).

Column	Type	Description
id	uuid (PK)	Mapping row
control_id	uuid (FK → controls.id)	Linked control
framework_id	uuid (FK → frameworks.id)	Linked framework
gap_level	text	Optional: none/partial/full (free text)
addendum	text	Optional notes
created_at	timestamptz	Default now()
UK	(control_id, framework_id)	Prevent duplicates

Table: mapping_references
External citations/cross-refs for a given mapping.

Column	Type	Description
id	uuid (PK)	Row id
mapping_id	uuid (FK → mappings.id)	Parent mapping
reference_code	text (UK w/ mapping_id)	External clause/code


⸻

C) Relationships (at a glance)
	•	evidence.audit_id → audits.id
	•	classification JSON inside evidence references canonical rows:
	•	framework_id → frameworks.id
	•	control_id → controls.id
	•	(optionally) mapping_id → mappings.id
	•	mappings.control_id → controls.id
	•	mappings.framework_id → frameworks.id
	•	mapping_references.mapping_id → mappings.id

Why this matters for MVP:
	•	The classifier can output stable references to canonical rows (frameworks, controls) and, when applicable, the exact crosswalk row (mappings).
	•	The UI can render human-friendly labels from those IDs, while the DB remains normalized for future reporting and reuse.


⸻

10. Environments & Configuration

Use env.example.txt as the template for:
	•	NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY (client).
	•	Server-side: SUPABASE_SERVICE_ROLE_KEY (only in Python backend), Postgres connection string (if not using Supabase client), OCR/LLM provider keys.
These files exist in the repo root for guidance.  ￼

⸻

11. Success Metrics
	•	≥ 80% of uploads auto-classified (no manual tag needed).
	•	Median classification confidence ≥ 0.75.
	•	Time to classify ≤ 10 seconds per upload.

⸻

12. Repository Snapshot (for orientation)
	•	src/ — Next.js/React app source.
	•	public/ — static assets.
	•	python-scripts/ — Python code location to evolve into the API service.
	•	components.json — Shadcn config present.
	•	next.config.ts, package.json, tsconfig.json, env.example.txt — project configs.  ￼

⸻

13. Open Items (kept minimal; needed later to implement)
	•	OCR provider (Tesseract vs cloud OCR vs LLM vision).
	•	Classification model and label set (frameworks/controls list).
	•	Trigger choice (frontend call vs storage webhook).
	•	File types/size caps and error handling rules.
	•	Exact JSON schema for classification (confirm the example shape above).
