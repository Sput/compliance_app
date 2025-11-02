## Compliance Evidence Classifier

Minimal MVP per plan: upload evidence → OCR parse (system, date) → classify to framework control(s) → persist & display.

### Environment Variables
- Next.js
  - `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL (public).
  - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key (public).
- Python service (server-side only)
  - `SUPABASE_URL`: Supabase project URL.
  - `SUPABASE_SERVICE_KEY`: Supabase service-role key (never expose to browser).
  - `PYTHON_OCR_PROVIDER` (optional): placeholder to select OCR provider.

Keep service keys server-side only. The Next.js app uses only anon key.

### Local Scripts
- Python FastAPI service: `python-scripts/service/app.py` (endpoint: `/process-evidence`).
- One-off processor: `python-scripts/process_evidence.py` (CLI-compatible; used by Next API route).
- Seeds: `seeds/seeds.sql` or `python-scripts/seeds.py`.

### Storage Bucket
- Create a Supabase Storage bucket named `evidence` and allow authenticated uploads.

### Notes
- OCR and classification modules are provider-agnostic and currently ship with conservative stubs for local dev.
