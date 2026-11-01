# 16 Local Supabase readiness

**Date:** 2026-10-20  
**Classification:** FAIL to run local stack (Docker missing). PASS that no migrate / Shopify install / flag-on / tunnel was performed.

## Inspected

| Check | Result |
|-------|--------|
| [`supabase/config.toml`](../../supabase/config.toml) | `project_id = POST_BUS_APP`, API port 54321, DB port 54322, Postgres 17 |
| Supabase CLI | **2.115.0** (`npx supabase --version`) |
| Docker on PATH | **FAIL** — `docker` / Podman not found; Docker Desktop binaries not in default Program Files paths |
| `npx supabase status` | **FAIL** — `docker: command not found`. Also reported CLI **linked_project** `hgacoeoovjxkzfbesmvl` / POSTBUS. Do **not** `supabase db push` while linked to production. This session did **not** `supabase link` or `unlink`. |
| `npx supabase start` | **NOT RUN** (Docker unhealthy / missing) |
| Shopify foundation SQL | **NOT applied** |
| Feature flag | remains **false** |
| Tunnel / `shopify app dev` / install | **NOT RUN** |

## Masked `.env.local` (`npx tsx scripts/stage-d-env-preflight.mts`)

| Field | Value |
|-------|--------|
| Public client ID | `a9d1…5b10` (length 32) |
| Public secret | present |
| Embedded flag | false |
| App URL | `http://localhost:3000` |
| Supabase host | `hgacoeoovjxkzfbesmvl.supabase.co` |
| Project ref | `hgacoeoovjxkzfbesmvl` (**production**) |
| Loopback | false |
| BYO API key/secret in this file | not present |

Secrets were not printed.

## Background job write risk

`.env.local` sets `JOB_RUNNER=database`. [`lib/env.ts`](../../lib/env.ts) `usesDatabaseJobRunner()` makes **`npm run dev` drain `background_jobs` against `NEXT_PUBLIC_SUPABASE_URL`**. That URL is currently production.

Until the URL is `http://127.0.0.1:54321`:

- Do not enable `SHOPIFY_EMBEDDED_APP_ENABLED`.
- Do not run `npm run workers` ([`workers/index.ts`](../../workers/index.ts) BullMQ).
- Treat `npm run dev` as **production-connected**.

## Overlay (prepared, unused until local stack exists)

- Tracked template: [`.env.shopify-local.example`](../../.env.shopify-local.example)
- Gitignored instance: `.env.shopify-local` (via `.env*` + `!.env.shopify-local.example`)
- Loopback URL only; empty key placeholders; flag **false**; do not copy production service-role JWTs.

## Docker setup (for later approval, not executed)

1. Install [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/) and ensure `docker` is on PATH.
2. Confirm `docker info` succeeds.
3. From this repo: `npx supabase start` (**no** `db push`, **no** production link).
4. Confirm API `127.0.0.1:54321` and project is not `hgacoeoovjxkzfbesmvl`.
5. Copy example → `.env.shopify-local` and fill keys from local `supabase status` on this machine only.
6. **Separate approval** before applying `20261020120000_shopify_public_app_foundation.sql`.

## Next (not this task)

Local migrate → then flag / tunnel / `tuzzstore.myshopify.com` install.
