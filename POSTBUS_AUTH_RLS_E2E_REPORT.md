# PostBus Auth / RLS E2E

Date: 2026-10-31  
Environment: `127.0.0.1:54321` GoTrue + PostgREST, synthetic `@postbus.invalid` users only.

## Command

`node scripts/staging/auth-rls-e2e.mjs`  
Result JSON: `scripts/staging/auth-rls-e2e-last.json`  
**25/25 passed** after local `GRANT` repair. Exit 0.

## Matrix

| Check | Result |
| --- | --- |
| Signup A/B | PASS |
| Local email confirm (`auth.users` on `supabase_db_postbuslocal` only) | PASS |
| Password login + access token | PASS (`role=authenticated`, no production `ref`) |
| Session refresh | PASS |
| Logout | PASS (204) |
| Unauthenticated orders | PASS (401) |
| Invalid token | PASS (401) |
| `create_organization_for_user` Org A and Org B | PASS |
| Org SELECT isolation | PASS |
| Address INSERT own org | PASS |
| Cross-tenant INSERT/SELECT/UPDATE/DELETE | PASS (403 / empty / unchanged) |

Service-role was **not** used as RLS evidence. Org create is `SECURITY DEFINER` by design; subsequent table access used user JWTs.

## Browser password login

`http://127.0.0.1:3001/login` rendered. Submit returned **Failed to fetch (127.0.0.1:54321)** inside the Cursor browser. Direct Node/GoTrue password grant on the same host succeeded. Treat UI session persistence as **not verified** in that browser.

## Verdict

**AUTHENTICATION: PASS** (API)  
**RLS: PASS** (API, after local grants)  
**MULTI-TENANCY: PASS** (API)  
**BROWSER LOGIN: FAIL** (fetch to Kong from that browser)
