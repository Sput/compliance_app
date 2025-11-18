# Operations Runbook – compliance_app

This app is a Next.js (App Router) service with embedded Python scripts. It ships as a single Docker image and is deployed on Coolify.

## Overview
- Runtime: Node 20 (Next.js standalone) + Python 3 in a venv at `/venv`.
- Entrypoint: `node server.js` (Next standalone output).
- Healthcheck: HTTP GET `/` (configured in Dockerfile).
- Image extras: `libvips` for sharp, `curl` for healthcheck.
- Debugging: Python debug snapshots disabled by default; opt-in via `AGENT_DEBUG_DIR`.

## Deploy (Coolify)
1. Source: Git → select repo + branch.
2. Build: `Dockerfile` at repo root, context `/` (auto-detected).
3. Network: HTTP Port `3000`, exposed to internet.
4. Environment variables (see below).
5. Deploy → watch logs until “listening on 0.0.0.0:3000”.

## Environment Variables
Required
- `NEXT_PUBLIC_SUPABASE_URL`: Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase anon key
- `NEXT_PUBLIC_SENTRY_DISABLED`: set to `true` unless Sentry is fully configured

Optional
- `OPENAI_API_KEY`: required only if using agent features
- `NEXT_TELEMETRY_DISABLED`: set to `1` to disable Next telemetry
- `PYTHON_PATH`: not required; image sets `PYTHON_PATH=/venv/bin/python`
- `AGENT_DEBUG_DIR`: set to a writable path (e.g., `/app/debug`) to enable Python JSON snapshots

Tip: In Coolify, mark sensitive values as secret and choose “Literal = Yes”.

## Routine Tasks
- Redeploy on push: enable Auto Deploy in Coolify if desired.
- Update Python deps: edit `requirements.txt` (pin versions), push, redeploy. Packages install into `/venv`.
- Update Node deps: update `package.json`/`yarn.lock`, push, redeploy.
- Base image refresh: trigger a rebuild periodically to pick up `node:20-slim` security updates.

## Health & Monitoring
- Healthcheck: container uses `curl http://localhost:3000/`.
- Logs (Coolify → Logs): watch for
  - sharp/libvips errors (image processing)
  - Python spawn errors (path, missing deps)
  - Next.js API exceptions

## Smoke Tests
- Root: `curl -fsS https://<your-domain>/ | head -n1` (expect HTML)
- Python API: `curl -fsS "https://<your-domain>/api/python?script=helloworld.py"` (expect success JSON)

## Troubleshooting
- Pip PEP 668 error: resolved by venv in image. If a package is missing, add to `requirements.txt` and redeploy.
- sharp/libvips errors: image already installs `libvips`. If issues persist, redeploy to ensure binaries match.
- Debug artifacts: disabled unless `AGENT_DEBUG_DIR` is set. To capture snapshots for diagnosis, set it and redeploy.
- Sentry build noise: keep `NEXT_PUBLIC_SENTRY_DISABLED=true` until `org`/`project` and server settings are ready.

## Scaling & Resources
- Adjust CPU/RAM limits in Coolify as needed for build/run.
- App is stateless; if you later persist files, mount a volume and update paths accordingly.

## Rollbacks & Releases
- Prefer deploying from a stable branch; tag releases.
- To rollback: redeploy a previous successful version in Coolify or point the app to an earlier tag/commit and redeploy.

## Domain & HTTPS
- Coolify → App → Domains → Add Domain → Save.
- HTTPS is auto-provisioned by the Coolify proxy (Traefik) if configured.

## Useful Paths
- Next standalone: app files at `/app` inside container; server entry is `server.js`.
- Python venv: `/venv` (python at `/venv/bin/python`, pip at `/venv/bin/pip`).

## Notes
- Do not put secrets in the Dockerfile. Manage them in Coolify.
- Keep `requirements.txt` and `yarn.lock` up to date and pinned to minimize surprises.
