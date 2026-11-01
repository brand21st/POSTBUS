# 03 Embedded iframe test report

**Scope:** Shopify Admin → Apps → PostBus inside Admin.

**Classification:** BLOCKED / PENDING LIVE VERIFICATION.

Stage D was explicitly planned-then-stopped. No Partner app, no development store install, no tunnel, no `shopify app deploy`.

## Tests

| Item | Result |
|------|--------|
| App loads in Shopify Admin | BLOCKED |
| App Bridge initializes | NOT TESTED (live) |
| No separate PostBus login | NOT TESTED (live) |
| Navigation / refresh / back | BLOCKED |
| Mobile-width Admin | BLOCKED |
| Console / CSP in Admin | BLOCKED |

## Local substitutes (not claimed as Admin tests)

- Flag off: `/shopify` HTTP 404, `/api/shopify/bootstrap` 404, `/dashboard` 307 (Phase 1 curl; not re-claimed as live iframe).
- Layout exists: [`app/shopify/layout.tsx`](../../app/shopify/layout.tsx) loads App Bridge + Polaris CDN `beforeInteractive`, `shopify-api-key` meta, `useAppBridge` fetch.

## Remaining blockers

Authorized Partner app + development store + HTTPS app URL + local flag true + isolated DB migration.
