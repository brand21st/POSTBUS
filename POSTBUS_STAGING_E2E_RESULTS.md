# PostBus staging E2E results

Date: 2026-10-31

## Auth / PostgREST

WSL Docker Supabase (`project_id=postbuslocal`) **starts**, then **crash-loops** (Postgres unclean shutdown every ~15–30s; Auth Restarting). Repeated health samples: mix of connect-fail and HTTP 200 while containers show `Up 1 second`. That is **not** stable Auth.

Stack was stopped. Authenticated login/logout/refresh/RLS/org isolation: **NOT VERIFIED**.

Port 3001 still serves staging Next. After stack stop, `/api/health` database is Error.

## Shopify / address UI / India Post / labels

Browser E2E: **NOT VERIFIED** (no Playwright, no stable Auth).

Service-level this session:

```
npx vitest run modules/orders/historical-classify.test.ts modules/india-post/booking-idempotency.test.ts
→ 2 files, 36 passed, exit 0
```

Earlier same session (before tsc fix): 3 files 46 passed including `p0-address-safety`.

India Post CEPT stub on 4099 is isolated. App booking through Next: **NOT VERIFIED**.

## Multi-tenant RLS

**NOT VERIFIED** (no stable user JWT against PostgREST).
