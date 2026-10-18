# Merchant API v1 — production smoke report

Date: 2026-10-18. App UUID `mw9larpomkyonxzy1rk3h6jm`. Git SHA `fd9021236e9c8e136ca20b80a38d1c0621c475a5` on `release/auth-session-on-prod`. Allowlist is one organization UUID (AURIMO BY NISH). The API is not open to all orgs.

Instant disable: set `MERCHANT_API_ENABLED=false` on Coolify and restart. Do not drop migration tables.

## Pre-flight

| Check | Result |
|---|---|
| `vitest` merchant-api + v1-permissions | PASS (29 tests) |
| `tsc --noEmit` | PASS |
| `npm run build` | PASS |
| Coolify UUID | PASS (`mw9larpomkyonxzy1rk3h6jm`) |
| `INTEGRATION_ENCRYPTION_KEY` / `SUPABASE_SERVICE_ROLE_KEY` present | PASS (values not printed) |
| Isolated merchant-only SHA (no billing/affiliates dirty tree) | PASS |
| Migrations `merchant_public_api` / `merchant_api_consume_rate_service_role_only` | PASS (already applied; RPC execute: service_role only) |
| `merchant_api_rate_buckets` RLS, no policies | PASS (intentional) |
| Booking path `runBookingNow: false` | PASS (code review; no Shopify/CEPT worker edits) |
| Postgres `archive_mode=on`, `wal_level=logical` | PASS (dashboard PITR toggle was not opened) |

## Deploy

| Check | Result |
|---|---|
| Coolify pin SHA + `force=true` deploy | PASS (`finished`, `running:healthy`) |
| `GET https://www.postbus.in/api/health` | PASS (`api`/`database` Healthy, `jobRunner=database`) |
| Health `jobs` / `shopify` / `indiaPost` | FAIL (`Warning` — pre-existing job/integration health, not a Merchant API 5xx) |
| `GET /api/merchant/v1/me` without key | PASS (401 `INVALID_API_KEY`) |

## Live smoke (allowlisted org only)

No live CEPT booking. Create used `source=API` only. Temporary HMAC key `prod-smoke-tmp` was revoked after the run.

| Test | Result |
|---|---|
| Auth none `GET /me` | PASS |
| Auth with allowlisted key `GET /me` | PASS (200 identity; org id is not in the public identity payload) |
| Portal — production dashboard login | BLOCKED (production session required; `/login` shown) |
| Portal — Developer API card hidden when org is off allowlist | PASS (local dashboard for the same org with empty local allowlist did not show the card) |
| Portal — create/copy/revoke/rotate on production | BLOCKED (not logged in on www.postbus.in) |
| Isolation — other-org UUID as order id | PASS (404 `RESOURCE_NOT_FOUND`) |
| Isolation — other-org shipment and label | PASS (404 `RESOURCE_NOT_FOUND` for a shipment owned by another organization) |
| Isolation — cannot list other org keys | BLOCKED (production dashboard session required) |
| Create `POST /orders` + Idempotency-Key | PASS (one order, `source=API`, no shipment) |
| Read list/get | PASS |
| `updated_since` | PASS (future timestamp returns an empty page) |
| cursor | PASS (`limit=1` then `next_cursor` returns a different order) |
| Idempotency replay | PASS |
| Idempotency conflict | PASS (`IDEMPOTENCY_CONFLICT`) |
| Rate limit 429 | NOT TESTED (general limit is 120/minute; extra requests were not sent) |
| Tracking + label on existing same-org shipment | PASS |
| Docs portal downloads | NOT TESTED |
| Google Apps Script sample | NOT TESTED |
| No `shipment-booking` / shipment from the create test | PASS |
| `merchant_api_request_logs` for the test org (last hour) | PASS (10 rows during the smoke window) |

## Rollout state

- `MERCHANT_API_ENABLED=true`
- `MERCHANT_API_ORG_ALLOWLIST` = that one org UUID
- Do not empty the allowlist to “open all” — empty still means deny everyone
