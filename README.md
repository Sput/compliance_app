##Evidence Classification Pipeline

A lightweight, production-oriented system for turning unstructured compliance artifacts into structured, reviewable evidence. Designed for SOC 2, PCI DSS, ISO 27001, HIPAA, GDPR, and similar frameworks.

The system uses Next.js, Supabase, and a Python agentic backend. It supports deterministic validation, LLM-based semantic classification, and optional multi-agent orchestration.

⸻

Features
	•	Artifact Upload (PDF, images, text files)
	•	OCR Extraction + metadata parsing
	•	Deterministic Gatekeeping (Date Guard)
	•	Agentic Control Classification
	•	Human Review Workflow
	•	Explainable JSON outputs
	•	Supabase-native storage/auth/postgres

⸻

Pipeline Overview
	1.	Upload → artifact stored in Supabase
	2.	Extract → text, dates, systems parsed
	3.	Classify → deterministic rules + agentic reasoning
	4.	Review → human Accept/Reject/Change
	5.	Persisted results are stored as typed JSON

This produces an auditable, repeatable classification pipeline suited for real compliance work.

⸻

##Agentic Architecture

The application implements a hierarchical agentic system, designed to keep reasoning modular, observable, and bounded. This takes inspiration from supervisor–worker designs common in agentic platforms (LangChain, “Agents v2,” CrewAI, Kazuki-style orchestration, etc.).

Agents are specialized, narrow, and constrained via JSON schemas, preventing drift and ensuring that outputs can be audited during an actual compliance review.

⸻

##Agent Roles

1. Supervisor Agent

Coordinates the entire process:
	•	Delegates tasks to Date Guard, Action Describer, Control Assigner
	•	Collects and validates their outputs
	•	Enforces ordering: Date Guard → Action Describer → Control Assigner 
	•	Handles failure states (e.g., out-of-range evidence date)
	•	Standardizes all outputs into structured JSON blocks

The Supervisor acts as a routing and verification layer, not a reasoning engine.

⸻

2. Date Guard (Deterministic + Agentic Hybrid)

Purpose: ensure the document’s evidence_date is within the audit period.
	•	Parses document date (regex + heuristics)
	•	Compares to audit_start/audit_end
	•	Returns structured result:

{ "status": "PASS"|"FAIL", "parsed_date": "YYYY-MM-DD", "reason": "..." }



If FAIL, the Supervisor halts the agentic chain and returns an immediate rejection.

This provides reliability and prevents the LLM from wasting tokens on out-of-scope artifacts.

⸻

3. Action Describer

Goal: summarize what the document proves in ≤120 words.
	•	No classification
	•	No creative expansion
	•	Strict summarization, constrained with a JSON schema:

{ "actions_summary": "..." }



This helps reviewers quickly understand the operational significance of each artifact.

⸻

4. Control Assigner

Maps evidence to the best-fitting security control for the chosen framework.
	•	Accepts parsed metadata + extracted text
	•	Uses vector similarity or LLM-based reasoning
	•	Returns:

{ "control_id": "...", "rationale": "..." }



This is the core semantic intelligence of the pipeline.

⸻

##Agent Orchestration Flow

The Supervisor enforces a strict execution order:

1. Date Guard
   └─ If FAIL → return early Reject
2. Action Describer
3. Control Assigner
4. Combine outputs → final JSON payload

This makes the workflow:
	•	Deterministic where required
	•	LLM-driven where helpful
	•	Auditable end-to-end

Each agent’s inputs/outputs can be logged for compliance traceability.

⸻

##Architecture

Frontend (Next.js + Supabase)
	•	Drag-and-drop uploader
	•	Classification summaries
	•	Review dashboard
	•	Supabase Auth + Storage
	•	Audit-aware filtering

Backend (Python)
	•	OCR (provider agnostic)
	•	Artifact text parsing
	•	Agent supervisor orchestration
	•	LLM classification + vector search
	•	Writes results to Supabase Postgres

All JSON outputs adhere to strict schemas, ensuring reliability.

⸻

##Data Model

Table	Purpose
audits	Audit metadata
evidence	Uploaded files
classifications	Candidate control matches
reviews	Reviewer decisions


⸻

Observability & Guardrails
	•	Deterministic pre-checks (Date Guard)
	•	Strict JSON contracts for all agent outputs
	•	Sandboxed prompts to reduce hallucination
	•	Output validation inside Supervisor
	•	Token + cost controls
	•	Trace logging for all agent calls

This ensures decisions can be defended during a real audit.

⸻

Roadmap
	•	Better reviewer UI
	•	Extended OCR support
	•	More granular rejection reasons

⸻

Reflections on the Agentic Approach

The hierarchical agentic architecture was intentionally used as an experiment. Compared to conventional structured function-calling, it introduces:

Pros
	•	Modular reasoning
	•	Reusable agent components
	•	Clear JSON-based audit trails
	•	Easier future expansion

Cons
	•	Higher complexity and fragility
	•	Supervisor logic can break easily
	•	Requires heavy guardrails to keep agents on track
	•	More moving parts than necessary for simple flows

In its current form, traditional function-calling may be simpler and more reliable. Agents may shine only when the application grows large enough to justify multi-agent reuse and complex reasoning chains.
