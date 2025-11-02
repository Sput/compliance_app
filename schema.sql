-- Enable UUID generation (Supabase-friendly)
create extension if not exists "pgcrypto";

-- =========================
-- Table: frameworks
-- =========================
create table if not exists public.frameworks (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  version      text,
  description  text,
  source_file  text,
  created_at   timestamptz not null default now(),
  constraint frameworks_name_version_uk unique (name, version)
);

comment on table  public.frameworks is 'Compliance frameworks (e.g., PCI DSS v4.0, NIST 800-53 r5).';
comment on column public.frameworks.name        is 'Framework name (e.g., "PCI DSS").';
comment on column public.frameworks.version     is 'Version/revision (e.g., "4.0", "rev 5").';
comment on column public.frameworks.source_file is 'Optional source filename/path for imported controls.';


-- =========================
-- Table: controls
-- =========================
create table if not exists public.controls (
  id          uuid primary key default gen_random_uuid(),
  control_id  text not null,   -- human-readable code, e.g., "10.2.1"
  title       text,
  category    text,
  created_at  timestamptz not null default now(),
  constraint controls_control_id_uk unique (control_id)
);

comment on table  public.controls is 'Canonical control catalog across frameworks (or per-framework code in control_id).';
comment on column public.controls.control_id is 'Public control code (e.g., "10.2.1").';


-- =========================
-- Table: mappings
-- =========================
create table if not exists public.mappings (
  id            uuid primary key default gen_random_uuid(),
  control_id    uuid not null references public.controls(id)   on delete cascade,
  framework_id  uuid not null references public.frameworks(id) on delete cascade,
  gap_level     text,      -- e.g., "none", "partial", "full" (free-text per your design)
  addendum      text,      -- optional notes
  created_at    timestamptz not null default now(),
  -- Avoid duplicate mapping rows for the same (control, framework)
  constraint mappings_control_framework_uk unique (control_id, framework_id)
);

comment on table  public.mappings is 'Joins a control to a framework with optional gap/notes.';
comment on column public.mappings.gap_level is 'Free-text or coded value indicating degree of coverage.';
comment on column public.mappings.addendum  is 'Additional mapping notes or clarifications.';


-- =========================
-- Table: mapping_references
-- =========================
create table if not exists public.mapping_references (
  id             uuid primary key default gen_random_uuid(),
  mapping_id     uuid not null references public.mappings(id) on delete cascade,
  reference_code text not null,   -- e.g., external cross-ref, clause, citation
  constraint mapping_references_uk unique (mapping_id, reference_code)
);

comment on table  public.mapping_references is 'External references/citations attached to a specific mapping.';
comment on column public.mapping_references.reference_code is 'External code/string for cross-reference.';


-- =========================
-- Helpful indexes
-- =========================
create index if not exists idx_mappings_control_id   on public.mappings(control_id);
create index if not exists idx_mappings_framework_id on public.mappings(framework_id);
create index if not exists idx_mapping_refs_mapping  on public.mapping_references(mapping_id);

-- (Optional) If you often search controls by category or title:
-- create index if not exists idx_controls_category on public.controls(category);
-- create index if not exists idx_controls_title_trgm on public.controls using gin (title gin_trgm_ops);

-- =========================
-- Table: audits
-- =========================
create table if not exists public.audits (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  description text,
  framework_id uuid references public.frameworks(id) on delete restrict,
  created_by  uuid,
  created_at  timestamptz not null default now(),
  audit_start date,
  audit_end date
);

comment on table  public.audits is 'Audit runs or projects that group evidence.';
comment on column public.audits.name is 'Human-friendly audit name.';
comment on column public.audits.framework_id is 'References frameworks.id for the audit\'s framework.';

-- Helpful index
create index if not exists idx_audits_created_by on public.audits(created_by);
create index if not exists idx_audits_framework_id on public.audits(framework_id);

-- =========================
-- Table: evidence
-- =========================
create table if not exists public.evidence (
  id              uuid primary key default gen_random_uuid(),
  audit_id        uuid references public.audits(id) on delete cascade,
  file_url        text not null,
  extracted_text  text,
  system          text,
  evidence_date   timestamptz,
  classification  jsonb,
  status          text not null default 'uploaded',
  uploaded_by     uuid,
  created_at      timestamptz not null default now()
);

comment on table  public.evidence is 'Uploaded evidence and processing outputs.';
comment on column public.evidence.classification is 'Classifier result: array of mappings with confidences.';

-- Helpful indexes
create index if not exists idx_evidence_audit_id on public.evidence(audit_id);
create index if not exists idx_evidence_status   on public.evidence(status);
create index if not exists idx_evidence_date     on public.evidence(evidence_date);

-- =========================
-- Table: evidence_uploads
-- =========================
create table if not exists public.evidence_uploads (
  id                  uuid primary key default gen_random_uuid(),
  audit_id            uuid not null references public.audits(id) on delete cascade,
  control             text null references public.controls(control_id) on delete set null,
  file_name           text not null,
  file_content_base64 text not null,
  uploaded_by         uuid,
  created_at          timestamptz not null default now()
);

comment on table  public.evidence_uploads is 'Raw document uploads (inlined as base64) tied to an audit.';
comment on column public.evidence_uploads.audit_id is 'References audits.id.';
comment on column public.evidence_uploads.control is 'Optional control code; references controls.control_id.';
comment on column public.evidence_uploads.file_name is 'Original file name from client.';
comment on column public.evidence_uploads.file_content_base64 is 'Base64-encoded file content (temporary approach).';

-- Helpful indexes
create index if not exists idx_evidence_uploads_audit_id on public.evidence_uploads(audit_id);
create index if not exists idx_evidence_uploads_control   on public.evidence_uploads(control);
create index if not exists idx_evidence_uploads_created   on public.evidence_uploads(created_at);
