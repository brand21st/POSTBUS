# POSTBUS NDR/RTO COOLIFY RELEASE PLAN

**DO NOT EXECUTE** without a separate explicit user authorization.

## Verified Coolify target (read-only API 200)

| Field | Value |
| --- | --- |
| Name | PostBus |
| Application UUID | `mw9larpomkyonxzy1rk3h6jm` |
| Git | `brand21st/POSTBUS` |
| Configured branch | `support-center-release` |
| Live commit | `67891d40ea8f7ad6c4f07890085c8dcefbfd4833` |
| Status | `running:healthy` |
| Build pack | nixpacks |
| Port | 3000 |
| Last online (API) | 2026-10-10 04:37:28 |

Do not print API tokens. `coolify.local.json` is gitignored.

## PRE-DEPLOYMENT

1. Release commit to ship: **`40ed3fb`** (local only today) **or** a cherry-pick of that commit onto `support-center-release`.
2. Production branch currently: `support-center-release`. Current local branch is **not** that branch.
3. Target app UUID above.
4. Backup: Postgres snapshot / Coolify-supported backup **before** first production write of new projections.
5. Health baseline: API Healthy, DB Healthy, jobs/shopify/indiaPost Warning.
6. DB: no new migration; `operational_status` already nullable.
7. Workers: same SHA as Next app (`JOB_RUNNER=database` on production health).
8. Rollback target: `67891d40ea8f7ad6c4f07890085c8dcefbfd4833`.

## DEPLOYMENT (documented only)

1. Land `40ed3fb` on the Coolify git branch (cherry-pick recommended).
2. Push that branch (separate approval).
3. Coolify deploy / rebuild nixpacks for PostBus.
4. Do not change webhook CIDRs, CEPT secrets, or cron.
5. Do not enable historical reconcile.

## POST-DEPLOYMENT

- GET `https://www.postbus.in/api/health`
- Observe new tracking ingest only
- Do not POST CEPT booking, Shopify, WhatsApp, or reconcile apply

## ROLLBACK

- Coolify redeploy commit `67891d40ea8f7ad6c4f07890085c8dcefbfd4833`
- Schema remains compatible
- **Projections written by new mapper are not automatically reverted**
- Workers must match rolled-back app SHA
- Empty webhook CIDR remains fail-closed if allowlist code stays; if rolling back webhook-allowlist, behavior returns to 67891d40 webhook code

## Branch risk

Deploying `india-post-true-bulk-candidate` as a whole would also ship support-center and bulk-booking commits (`aa3e06a`, `ea223a0`, `c945993`, `531c088`). That is **out of scope** for an NDR-only release.
