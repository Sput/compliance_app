plan.md
# MVP Feature Implementation Plan (Compliance Evidence Classifier)

**Overall Progress:** `82%`

> Scope strictly matches the PRD: upload evidence → OCR parse (system, date) → classify to framework control(s) → persist & display. Future features (review/approval, progress tracking, reuse) are *out of scope* for this plan.

---

## Tasks

- [x] 🟩 **Step 1: Repo & Environment Baseline**
  - [x] 🟩 Confirm Supabase project keys and URLs via existing `.env.local` pattern; keep service-role key server-side only.
  - [x] 🟩 Verify Supabase Auth is enabled for login in the Next.js app.
  - [x] 🟩 Add minimal README notes for required env vars (Next + Python).

- [x] 🟩 **Step 2: Database Schema Verification (No-Op if Present)**
  - [x] 🟩 Verify existence of canonical tables: `frameworks`, `controls`, `mappings`, `mapping_references`.
  - [x] 🟩 Verify operational tables: `audits`, `evidence` with required columns:
        - `evidence`: `id`, `audit_id`, `file_url`, `extracted_text`, `system`, `evidence_date`, `classification jsonb`, `status`, `uploaded_by`, `created_at`
  - [x] 🟩 Validate constraints & indexes:
        - `frameworks (name, version)` unique
        - `controls.control_id` unique
        - `mappings (control_id, framework_id)` unique + FKs
        - Helpful indexes on `mappings.control_id`, `mappings.framework_id`
  - [x] 🟩 If discrepancies found, apply **additive** migrations only (`ALTER TABLE ADD COLUMN`, `CREATE INDEX`). **No destructive changes.**
  - [x] 🟩 Record schema check result (timestamp + schema version/hash) in a simple changelog note.

- [x] 🟩 **Step 3: Frontend Upload UI (Next.js + Shadcn)**
  - [x] 🟩 Build *Evidence Upload* form (single-file, drag/drop or file input).
  - [x] 🟩 Upload file directly to **Supabase Storage** using a signed upload flow.
  - [x] 🟩 After upload, POST metadata (audit id + storage path) to Python API to start processing.
  - [x] 🟩 Show immediate “Uploading → Processing” status.

- [ ] 🟨 **Step 4: Python Service – API Skeleton**
  - [x] 🟩 Create minimal web service (FastAPI/Flask) with `/process-evidence` endpoint.
  - [x] 🟩 Validate input (storage path, user, audit id); fetch file via signed URL or public URL.
  - [ ] 🟥 Write initial `evidence` row (`status='processing'`).

- [ ] 🟨 **Step 5: OCR & Parsing (System, Date)**
  - [x] 🟩 Implement OCR module (provider per env) to extract raw text.
  - [x] 🟩 Parse `system` (rule or lookup) and `evidence_date` (robust date parser).
  - [ ] 🟥 Persist `extracted_text`, `system`, `evidence_date` back to `evidence`.

- [ ] 🟨 **Step 6: Classification to Controls**
  - [x] 🟩 Load canonical data (`frameworks`, `controls`, optional `mappings`) for label space.
  - [x] 🟩 Classify evidence text → candidate list of `{framework_id, control_id, (mapping_id?), confidence}`.
  - [ ] 🟥 Save to `evidence.classification` JSON and set `status='classified'` (or `error` on failure).

- [x] 🟩 **Step 7: Frontend Results Display**
  - [x] 🟩 Add a simple *Evidence List* view for the current audit.
  - [x] 🟩 Show each item’s `status` and, when available, top classification (framework → control code/title + confidence).
  - [x] 🟩 Provide basic error state messaging (OCR fail / low confidence).

- [x] 🟩 **Step 8: Minimal Security & Ops**
  - [x] 🟩 Ensure Python service uses server-side Supabase key; Next.js uses anon key only.
  - [x] 🟩 Configure CORS narrowly for the frontend origin.
  - [x] 🟩 Limit accepted file types/sizes at upload and server validation.

- [ ] 🟨 **Step 9: Seeds & Sanity Checks**
  - [x] 🟩 Seed a small canonical dataset (a few `frameworks`, `controls`, and `mappings`) for local testing.
  - [ ] 🟥 Manual smoke test: upload → processing → classified → list renders result.

- [ ] 🟨 **Step 10: Minimal Test Harness (Now)**
  - [x] 🟩 Python (pytest): unit tests for date/system parsing; classifier JSON contract; API contract for `/process-evidence` (with stubs/mocks).
  - [ ] 🟥 Frontend (Vitest + RTL): upload form fires correct POST; evidence list renders status & top classification.
  - [ ] 🟥 Schema probes: verify required tables/columns exist (no-op if already correct).
  - [x] 🟩 Fixtures: tiny OCR text samples + micro seeds for frameworks/controls/mappings.

---

## Notes
- Eventing is **explicit call from frontend to Python** after upload (no webhooks/queues) to stay minimal.
- `classification` JSON stores IDs that point to canonical tables (future UI can dereference without schema changes).
- No review/approval, progress dashboards, or evidence reuse in this MVP plan.
