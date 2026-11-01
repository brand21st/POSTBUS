# PostBus staging infrastructure recovery

Date: 2026-10-31  
Target: local Docker Supabase `project_id=postbuslocal` (API `127.0.0.1:54321`, DB host port `54332`).  
**Not production** (`hgacoeoovjxkzfbesmvl`).

## Root cause

WSL Docker had enough RAM/disk. PostgreSQL inspect `OOMKilled=false`. Kong HTTP 503 was a **consequence** of Auth/DB restarts, not a primary DNS bug.

Two amplifying factors:

1. Extra services. Valid exclude names are `storage-api` and `supavisor`, not `storage`/`pooler`. Invalid excludes were ignored; Storage still started.
2. Local CLI 2.115 does **not** grant `authenticated` on existing `public` tables. Password login worked; PostgREST then returned `42501 permission denied for table organizations`. Production still has those grants (read-only check: `org_select/addr_select/order_select/ship_select = true`).

## Repair (local only)

- Restarted `supabase-linux start -x studio,imgproxy,logflare,vector,edge-runtime,realtime,storage,pooler`.
- Did **not** run `supabase status` after start (previously recreated extra services).
- Applied `scripts/staging/grant-authenticated-local.sql` via `docker exec` on `supabase_db_postbuslocal` only.
- Fresh local start applied `20261030143000_shopify_address_normalization.sql`.

## Stability evidence

| Window | Auth `/auth/v1/health` | `supabase_db` RestartCount | `supabase_auth` RestartCount |
| --- | --- | --- | --- |
| 07:36:31–07:38:00 (8 samples ~96s) | 200 × 8 | 0 | 0 |
| After Auth/RLS E2E | 200 | 0 | **3** (boot/restart residue) |
| 07:44+ (6 samples ~60s) | 200 × 6 | 0 | 3 (unchanged) |

Clean stop/start of the full stack was **not** repeated in this pass after the Auth restart count rose from 0 to 3.

## Verdict

**STAGING INFRASTRUCTURE: CONDITIONALLY STABLE** for API tests. Not a production-grade local platform: Auth restarted three times after start; Storage still present; local table grants are not in a shippable migration (production already granted).

Do not use this stack as production. Do not `supabase db push`.
