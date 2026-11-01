# PostBus staging runtime E2E report

Date: 2026-10-30  
Scope: localhost only. Hosted staging was not used. Production was not used.

## Isolation evidence

| Port | Role | State | PID |
| --- | --- | --- | --- |
| 3000 | Production-configured `next dev` | LISTENING `0.0.0.0` | **49940 (untouched)** |
| 3001 | Isolated staging Next | LISTENING `127.0.0.1` | 824 (this session) |
| 55432 | Local `postbus_staging` PostgreSQL | LISTENING `127.0.0.1` | 65260 |
| 4099 | CEPT stub | LISTENING `127.0.0.1` | 60052 |
| 54321 | Supabase API (GoTrue / PostgREST) | **not listening** | — |

Docker is not installed. An isolated local Supabase stack could not be started.

`.env.staging.local` `NEXT_PUBLIC_SUPABASE_URL` is `http://127.0.0.1:54321` (not `hgacoeoovjxkzfbesmvl`). SHA-256 prefixes of staging anon/service-role strings do not match production `.env.local`.

`npm run dev:staging` injects `.env.staging.local`, blanks production-only `.env.local` keys that are absent from the staging file, forces `POSTBUS_ENV=staging`, binds `127.0.0.1:3001`, and uses `POSTBUS_NEXT_DIST_DIR=.next-staging`.

Next.js still prints `Environments: .env.development.local, .env.local`. Effective runtime identity was verified via `GET /api/health/runtime` (staging-only; 404 outside `POSTBUS_ENV=staging`).

## Runtime identity (`GET http://127.0.0.1:3001/api/health/runtime`)

```json
{
  "postbusEnv": "staging",
  "appHost": "127.0.0.1:3001",
  "supabaseHost": "127.0.0.1:54321",
  "indiaPostUatHost": "127.0.0.1:4099",
  "indiaPostProdHost": "127.0.0.1:4099",
  "shopifyConfigured": false,
  "razorpayConfigured": false,
  "jobRunner": "database",
  "productionSupabaseDetected": false
}
```

Anon/service-role “present” flags are true because dummy non-production strings exist in `.env.staging.local`. They are not the production JWTs.

## Health (`GET http://127.0.0.1:3001/api/health`)

```json
{
  "api": "Healthy",
  "database": "Error",
  "redis": "Disabled",
  "jobRunner": "database",
  "jobs": "Unknown",
  "shopify": "Warning",
  "indiaPost": "Warning"
}
```

`database: Error` is expected: health probes GoTrue at `{supabaseUrl}/auth/v1/health`, and port 54321 is down. The Next process does **not** connect to PostgreSQL `55432`. The application uses `@supabase/ssr` / PostgREST / Auth, not a raw `DATABASE_URL`.

## CEPT stub

`GET http://127.0.0.1:4099/health` → `provider_mode: STUB`.  
`POST http://127.0.0.1:4099/book` → `{ success: true, stub: true }`. No `indiapost.gov.in` / `cept.gov.in` hosts in staging env.

## Application-to-database E2E

**Not achieved.** The running app on 3001 cannot read `postbus_staging` on 55432. Direct `psql` against 55432 succeeded (see migration section in the audit). That is SQL-level verification, not application persistence.

## Auth / RLS / UI

Login HTML `GET /login` on 3001 returned HTTP 200. No GoTrue session can be created. Browser address-review E2E was **not** executed. Playwright is not in the repository. Multi-tenant RLS is **not** present on the bootstrap staging cluster (9 public tables, no policies inspected as production-equivalent).

## Proof script

`node scripts/staging/e2e-proof.mjs` → `ok: true` after schema-correct joins (`orders.shipping_address_id`, `shipments.status`).

## Blocker

Isolated Supabase Auth + PostgREST (or an approved non-production hosted project with `POSTBUS_STAGING_PROJECT_REF`) is required before claiming staging application E2E, authentication, or RLS.
