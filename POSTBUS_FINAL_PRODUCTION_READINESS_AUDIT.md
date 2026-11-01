# POSTBUS Final Production Readiness Audit

Date: 2026-10-30  
Previous score: 74/100  
This audit score: **82/100**  
**Mandatory GO gates: FAILED** (hosted staging, live Shopify, isolated UI, release changeset).

## What improved since 74/100

- Next.js production build **exit 0** with TypeScript on (16.0s typecheck in-build, 130/130 static pages, 8 GB heap).
- ESLint **0 errors**.
- `npm run typecheck` uses `tsconfig.build.json` (non-incremental).
- Booking-dimension tests aligned with fail-closed READY addresses.

## What remains blocking for production execution

1. No running isolated staging database (54321 down).
2. Migration not applied to any shared/hosted staging Postgres.
3. Live Shopify / CEPT / UI smoke not executed on an isolated app.
4. Working tree is a large mixed changeset — not a releasable PR.
5. Production PITR/backup not re-confirmed against a named staging project (there isn’t one live).

## P0 defects (code)

| ID | Engineering | Staging/live |
| --- | --- | --- |
| P0-01 Accept bypass | FIXED (unit) | Not UI-verified |
| P0-02 Legacy overwrite | FIXED (SQL + PGlite) | Not hosted-applied |
| P0-03 GraphQL wipe | FIXED (unit) | Not live webhook |
| P0-04 Barcode before gate | FIXED (source + unit) | No live allocate |
| P0-05 Revalidate override | FIXED (unit) | Not UI-verified |
| P0-06 Restore classify | FIXED (unit) | Not UI-verified |
| P0-07 NULL bookable | FIXED (unit) | Not live book |
| P0-08 App before migration | Runbook exists | Migration not on hosted staging |

## Compatibility

- Schema expand is additive. Old app can run after columns exist (booking gate in old app does **not** fail-close NULL).
- New app **must not** deploy before the migration: it reads/writes new columns and fail-closes unvalidated addresses (historical unbooked orders become non-bookable until Revalidate).
- Workers must ship the same booking-run as the web app.

## Security

RLS on `addresses` unchanged by this migration. Service-role booking path is org-scoped in queries. Cross-tenant HTTP not proven this run.

## Score (not a GO override)

| Area | /100 contribution (illustrative) |
| --- | --- |
| P0 code | 18 |
| Build/typecheck/lint | 16 |
| Isolated migration proof | 10 |
| Live staging + Shopify smoke | 0 (blocked) |
| UI isolated smoke | 0 |
| Security HTTP | 6 (partial) |
| Release hygiene | 4 (dirty tree) |
| Runbook | 8 |
| **Total** | **82** |

Score must not override failed mandatory gates.
