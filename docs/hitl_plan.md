# Human-in-the-Loop (HITL) Plan

This plan introduces stepwise, human-curated evidence processing with pause-review-edit-approve loops between each agentic stage. It aligns with constraints:
- UI location: `src/app/dashboard/hitl/page.tsx`.
- Python logic: `python-scripts/hitl.py`.
- TypeScript bridge: `python-scripts/hitl.ts`.
- Transport: Node child_process from Next.js API routes under `src/app/api/hitl/*`.
- No refactors of `evidence_process_agents.py`; re-create functionality in `hitl.py`.
- DB changes: provide schema only.

## Progress Summary

Completed
- Stages and contracts: implemented in code; UI wired to stages.
- Python HITL engine: CLI subcommands with enhanced heuristics for system, date, date_guard, candidates, selection, finalize.
- TypeScript bridge: child_process integration and `HITL_MOCK` mode.
- API endpoints: `/api/hitl/start`, `/api/hitl/run`, `/api/hitl/apply`, `/api/hitl/session`.
- HITL UI flow: stepper with propose/approve, resume by session ID, minimal validation and error summary.

 Partially Completed
- Persistence & resume: sessions and steps persisted; finalize write-back to `evidence` implemented.
- Error handling & safeguards: truncation + minimal validation done; richer guards and UX hints pending.
- Testing & dev ergonomics: mock mode in place; unit/integration/UI tests pending.
- Telemetry: elapsed_ms timing included; event logging not yet implemented.

Not Started
- Security & permissions: route/user auth guard (per guidance, no roles needed) not yet added.
- Optional Back action/endpoint: not implemented.

 Milestones
- M1: Contracts + schemas — Completed
- M2: UI skeleton with mock data — Completed
- M3: Wire core stages — Completed
- M4: Persistence + finalize — Completed
- M5: Tests + polish — Not started

## 1) Stages and Contracts

Stages run in order and always wait for human approval before advancing. Each stage has inputs, a model_output proposal, optional human edits, and a decided_output (the final for that stage).

1. ingest_text
   - Input: `evidence_id`, `file_url`, optional raw text.
   - Model output: `{ text, source, truncated, length }`.
   - Human input: edit/replace text, mark redactions.
   - Decided output: `{ text }`.

2. extract_system
   - Input: `{ text }`.
   - Model output: `{ system: string, confidence: number, rationale: string }`.
   - Human input: corrected `system`.
   - Decided output: `{ system }`.

3. extract_date
   - Input: `{ text }`.
   - Model output: `{ evidence_date: ISODate | null, candidates: ISODate[], confidence, rationale }`.
   - Human input: choose/change date or null.
   - Decided output: `{ evidence_date }`.

4. date_guard
   - Input: `{ evidence_date, window?: {start,end} }`.
   - Model output: `{ status: 'pass'|'fail'|'unknown', parsed_date, reason }`.
   - Human input: override status or window.
   - Decided output: `{ status, parsed_date }`.

5. control_candidates
   - Input: `{ text }`.
   - Model output: `{ candidates: [{id,label,confidence,rationale}] }`.
   - Human input: reorder/remove/add candidates.
   - Decided output: `{ candidates }`.

6. select_control
   - Input: `{ candidates }`.
   - Model output: `{ selection: {id,label}, confidence, rationale }`.
   - Human input: choose selection.
   - Decided output: `{ selection }`.

7. finalize_classification
   - Input: accumulated decided outputs.
   - Model output: `{ classification: {...}, summary }`.
   - Human input: optional edits; approve to write back to `evidence`.
   - Decided output: persisted to DB.

### 1.1 Shared Type Contracts (conceptual)

```jsonc
// StepInput
{
  "session_id": "uuid",
  "evidence_id": "uuid",
  "stage": "ingest_text | extract_system | extract_date | date_guard | control_candidates | select_control | finalize_classification",
  "payload": { /* stage-specific */ }
}

// StepModelOutput
{
  "stage": "...",
  "model_output": { /* stage-specific proposal */ },
  "meta": { "elapsed_ms": 1234, "tokens": 456, "warnings": [] }
}

// StepHumanInput
{
  "stage": "...",
  "edits": { /* fields mirroring model_output as needed */ },
  "reason": "why edited",
  "approved": true
}

// StepResult (decided)
{
  "stage": "...",
  "decided_output": { /* final for this stage */ },
  "reviewer_id": "user-id-or-null",
  "decided_at": "ISO"
}
```

Python will define pydantic/dataclass schemas; TS will mirror with zod.

## 2) Session State Model

- Session
  - `session_id: uuid`
  - `evidence_id: uuid`
  - `current_stage: enum(Stage)`
  - `status: 'active'|'completed'|'error'`
  - `latest_result: StepResult | null`
  - `created_at`, `updated_at`
- History entry
  - `stage, model_output, human_input, decided_output, reviewer_id, decided_at`

Supports: resume, audit trail, back navigation.

## 3) DB Schema (Final Form)

Provide to you to create; names are snake_case for Postgres.

```sql
-- Table: hitl_sessions
CREATE TABLE public.hitl_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evidence_id uuid NOT NULL,
  current_stage text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  latest_result jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hitl_sessions_evidence_id_idx ON public.hitl_sessions (evidence_id);
CREATE INDEX hitl_sessions_status_idx ON public.hitl_sessions (status);

-- Table: hitl_steps (immutable history of decisions)
CREATE TABLE public.hitl_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.hitl_sessions(id) ON DELETE CASCADE,
  stage text NOT NULL,
  model_output jsonb NOT NULL,
  human_input jsonb,
  decided_output jsonb NOT NULL,
  reviewer_id text,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hitl_steps_session_id_idx ON public.hitl_steps (session_id);
CREATE INDEX hitl_steps_stage_idx ON public.hitl_steps (stage);
```

Notes
- `latest_result` duplicates the most recent `hitl_steps.decided_output` for quick reads.
- If you prefer embedding in `evidence`, we can drop these tables and store session JSON in `evidence.hitl_session`.

## 4) Python HITL Engine (python-scripts/hitl.py)

Guidelines
- Re-create stage logic (do not import/modify `evidence_process_agents.py`).
- Deterministic IO; strict JSON in/out on stdout; errors on stderr with non-zero exit.
- Small, composable functions per stage; prompt windows bounded and validated.

CLI Subcommands (JSON stdin → JSON stdout)
- `start` → create session state (no DB write; API layer persists)
- `run-stage` → compute `model_output` for a stage
- `apply-edits` → validate `StepHumanInput` and produce `StepResult`
- `summarize` → produce combined classification preview

Example Contracts
```bash
# Start
node_api -> python: { evidence_id }
python -> node_api: { session: {session_id, current_stage: 'ingest_text', status: 'active'} }

# Run stage
node_api -> python: { session_id, stage, payload }
python -> node_api: { stage, model_output, meta }

# Apply edits (advance)
node_api -> python: { session_id, stage, model_output, human_input }
python -> node_api: { stage, decided_output }
```

Error Handling
- Return `{ error: { code, message, details } }` with non-zero exit; Node bridge maps to typed errors.

## 5) TypeScript Bridge (python-scripts/hitl.ts)

Responsibilities
- Spawn `hitl.py` with subcommand; pass/receive JSON via stdin/stdout.
- Validate request and response using zod schemas mirroring Python types.
- Expose functions for API routes:
  - `startSession(evidenceId) -> SessionState`
  - `runStage(sessionId, stage, payload) -> StepModelOutput`
  - `applyEdits(sessionId, stage, modelOutput, humanInput) -> StepResult`
  - `getSummary(sessionId) -> Summary`

Operational Notes
- Timeouts and max buffer sizes.
- Normalize errors and redact sensitive fields.

## 6) API Endpoints (src/app/api/hitl/*)

Endpoints (route handlers)
- `POST /api/hitl/start` → body: `{ evidenceId }` → returns `SessionState` and persists `hitl_sessions` row.
- `POST /api/hitl/run` → body: `{ sessionId, stage, payload }` → returns `StepModelOutput`.
- `POST /api/hitl/apply` → body: `{ sessionId, stage, modelOutput, humanInput }` → persists `hitl_steps`, updates `hitl_sessions.current_stage` and `latest_result`.
- `GET /api/hitl/session?sessionId=...` → returns current session state and last decided output.
- `POST /api/hitl/back` (optional) → logically revert `current_stage` to previous step (history immutable).

Persistence
- API writes to the tables you create using server-side code (we’ll add that later upon approval).

## 7) HITL UI (src/app/dashboard/hitl/page.tsx)

Core UI Elements
- Evidence Viewer: file preview (if available) and extracted text panel with expand/collapse.
- Stepper: shows all stages with current highlighted, completed checkmarks.
- Proposal Panel: shows `model_output` with rationale and confidences.
- Edit Panel: form inputs specific to stage, validation, diff vs proposal.
- Actions: Back, Approve & Continue, Save Draft.
- Resume: reads `session_id` from query param or creates a session via `/api/hitl/start`.

Stage-Specific Forms
- ingest_text: large textarea; redaction toggle; length counters.
- extract_system: select + text input; confidence indicator; quick picks.
- extract_date: date picker + candidate list; timezone handling.
- date_guard: status dropdown; window fields; reason required on override.
- control_candidates: sortable list; add/remove; rationale viewer per item.
- select_control: radio list; detail preview.
- finalize: summary; confirmation to persist to evidence.

Accessibility/UX
- Keyboard shortcuts: approve (Cmd/Ctrl+Enter), back (Cmd/Ctrl+[), save (Cmd/Ctrl+S).
- Focus management on step change; ARIA labels; inline validation.

## 8) Persistence & Resume

Flow
- On start: create `hitl_sessions` row.
- On run: compute proposal; not persisted until apply.
- On apply: insert `hitl_steps` and update `hitl_sessions`.
- Resume: fetch session by `session_id` and render `current_stage` with last decided output pre-filled.
- Finalize: write outputs into `evidence` (system, evidence_date, classification JSON, status).

## 9) Error Handling & Safeguards

- Timeouts on Python calls; clear error toasts with retry.
- Oversized evidence: chunk with pagination; clearly indicate truncation.
- Allow skip/unknown for date/selection with explicit confirmation.
- Log sequence of events (telemetry section) without PII.

## 10) Security & Permissions

- No role restrictions per guidance.
- Ensure only authenticated users invoke API routes (to be added later with approval). 
- Sanitize any model rationale before rendering; never render raw HTML.

## 11) Testing Strategy

Python
- Unit tests per stage with golden fixtures.
- CLI contract tests (stdin/stdout JSON) for success and failure paths.

TypeScript
- Zod contract tests for bridge I/O.
- Child_process harness tests with mock Python mode.
- API route integration tests (happy path + error mapping).

UI
- RTL tests for step navigation, validation, approve/back flows.
- Snapshot tests for proposal vs edit diffs.

Mock Mode
- Deterministic canned outputs when env `HITL_MOCK=1`.

## 12) Telemetry

- Events: `session_start`, `stage_run`, `model_done`, `human_edit`, `approve`, `back`, `finalize`, `error`.
- Store minimal fields (session_id, stage, timing, sizes); avoid content.

## 13) Milestones

M1: Contracts + schemas
- Define Python/TS schemas; deliver DB DDL; Python CLI stubs; TS bridge stubs.

M2: UI skeleton with mock data
- Stepper + panels + actions; mock mode through API.

M3: Wire core stages
- Implement `extract_system`, `extract_date`, `control_candidates` end-to-end.

M4: Persistence + finalize
- Hook DB tables; finalize to `evidence` fields.

M5: Tests + polish
- Add tests across layers; performance pass; UX refinements.

## 14) Open Items (Resolved by You)

- Transport: child_process via API routes.
- DB: implement final-form tables per DDL above.
- No role approvals required for HITL finalize.

## 15) Assumptions & Non-Goals

- Assumes evidence files are already uploaded and text is available or retrievable for ingest.
- No refactor of existing agents; parallel, self-contained implementation in `hitl.py`.
- No external services beyond current stack; network keys handled via existing env patterns.

---

If you approve the DB schema, I’ll proceed to scaffold `hitl.py` CLI and the TS bridge stubs, then implement API handlers to enable the UI with mock mode.
