# PostBus final production GO / NO-GO

Date: 2026-10-31

## Mandatory gates

| Gate | Status |
| --- | --- |
| Staging runtime stable this preflight | PASS (containers up, Auth 200, no rebuild) |
| GoTrue / PostgREST / JWT / RLS API | PASS earlier (25/25) and login works in browser |
| Browser login, dashboard, orders, reload keeps session | PASS |
| Invalid password stays on `/login` with "Invalid login credentials" | PASS |
| Sign out returns to `/login` | PASS |
| Shopify live import/webhook | NOT EXECUTED |
| Synthetic stored-address classify (READY / bad PIN / line 3 kept) | PASS |
| India Post booking against `127.0.0.1:4099` only | PASS (`process-articles` hit = 1, status BOOKED) |
| Invalid PIN allocates no barcode | PASS |
| Retry keeps the same local stub barcode | PASS |
| Cross-tenant booking rejected | PASS |
| Label PDF / rendered Unicode | NOT EXECUTED (line-3 wrap asserted in the booking script) |
| Migration file present; not applied on production | PASS as plan |
| Release changeset isolated as a SHA | FAIL (proposal only; not committed) |
| TypeScript this pass | FAIL (heap OOM at 8 GB; not a clean isolated install) |
| ESLint on the booking files this pass | PASS |
| Vitest on booking, origin, and historical classify | PASS (47) |
| `build:verify` on an isolated tree | NOT RE-RUN |
| Production backup point verified | FAIL (no backup/PITR tool in the connected project API) |
| Restore drill | FAIL |

## Decision

**PRODUCTION DEPLOYMENT: NO-GO**

**POSTBUS PRODUCTION RELEASE CANDIDATE: NOT READY**

## Safety

- Production database unchanged  
- No production migration  
- No Coolify deployment  
- No production Shopify mutation  
- No real India Post booking  
- No production barcode allocation  
- No production order reprocessing  
- No Git commit  
- No Git push  
- `postbuslocal` volume not deleted  
