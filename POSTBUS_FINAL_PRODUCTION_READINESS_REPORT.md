# POSTBUS Final Production Readiness Report

**Date:** 30 October 2026  
**Branch:** `fix/auth-session-stability`  
**Score:** **79 / 100**  
**Recommendation:** **NO-GO — PRODUCTION DEPLOYMENT BLOCKED**

Production database, production migration, production booking, production barcodes, git commit, and git push were **not** performed.

---

## 1. Executive Summary

P0 address/import/booking defects remain fixed. Additional P1 work landed: custom-label `line3`, India Post PIN `000000` rejected, OpenRouter address AI concurrency cap (3) plus credit debit, in-place historical classify (dry-run), migration indexes, isolated PGlite migration on populated tables, and a TypeScript OOM mitigation (stop compiling leftover `.next-*` trees).

`tsc --noEmit` now passes with a 16 GB Node heap. `next build` compiled the app then **died in its own TypeScript phase** at ~16 GB. Live Shopify and hosted staging were not used.

## 2. All P0 fix status

| ID | Status |
| --- | --- |
| P0-01 | FIXED AND VERIFIED (unit) |
| P0-02 | FIXED AND VERIFIED on PGlite; hosted staging NOT APPLIED |
| P0-03 | FIXED AND VERIFIED (unit) |
| P0-04 | FIXED AND VERIFIED (code order + unit) |
| P0-05 | FIXED AND VERIFIED (unit) |
| P0-06 | FIXED AND VERIFIED (unit) |
| P0-07 | FIXED AND VERIFIED (unit) |
| P0-08 | FIXED AND VERIFIED for schema-first contract; rollout still blocked by `next build` |

## 3. Additional bugs found and fixed

| Issue | Fix |
| --- | --- |
| Custom labels omitted line 3 | `officialAddressLines` + packing slip mapping |
| CEPT PIN `/^\d{6}$/` accepted `000000` | `^[1-9][0-9]{5}$` |
| Address AI unmetered / unbounded | slot cap 3 + `consumeAiCredit` |
| `Button variant="outline"` invalid | `dark-outline` |
| `tsc` OOM from extra `.next` type roots | narrowed `tsconfig.json` include/exclude |
| Historical NULL never classifiable without Shopify overwrite | `classifyHistoricalOrganizationAddresses` |

## 4. Migration verification

See `POSTBUS_STAGING_MIGRATION_REPORT.md`. Isolated PGlite: **pass**. Hosted staging SQL: **not executed**.

## 5. Shopify import verification

Unit/fixture only (merge, upsert mocks, GraphQL mapping). **Live store: NOT EXECUTED.**

## 6. Address review verification

Unit tests for accept/restore/revalidate/manual lock. **Browser/dashboard: NOT EXECUTED.**

## 7. India Post booking verification

`shippingAddressBookingBlock` fail-closed; article validator PIN; booking-run gate before allocate. **CEPT sandbox HTTP: NOT EXECUTED.**

## 8. Barcode allocation verification

Source order in `booking-run.ts`; Ship enqueue skipped when blocked. **Live allocate: NOT EXECUTED.**

## 9. Label generation verification

Unit: line3 included. Unicode PDF / booked snapshot table: **NOT newly verified in a renderer.**

## 10. Security verification

Existing org_id filters unchanged. RLS not re-proven this pass. Cross-tenant HTTP **NOT EXECUTED**. Address AI still omits names/phones from the model payload. Credits now debit on successful apply when org is present.

## 11. Performance verification

Synthetic classify/unit only. 100–10,000 import **NOT EXECUTED**. `tsc` needs ~16 GB heap on this machine.

## 12. TypeScript results

**PASSED** (`NODE_OPTIONS=--max-old-space-size=16384`, `tsc --noEmit --incremental false`). 8 GB still insufficient before tsconfig trim; 16 GB succeeded after.

## 13. Next.js build results

**FAILED.** Turbopack compile succeeded; Next “Running TypeScript” OOM ~16 GB; exit 1.

## 14. Test summary

| Result | Evidence |
| --- | --- |
| Passed | Related suites 142 + PGlite 3; payment test re-run 1 passed |
| Failed | Combined run 1 timeout under `next build` load (later passed) |
| Not executed | Live Shopify, CEPT, hosted staging, load, full eslint |

## 15. Historical order impact

Cannot quantify production counts (production query forbidden). Behavior: NULL status cannot book; booked rows skipped by classify helper; street fields not rewritten. Merchants must Revalidate or run dry-run classify after deploy.

## 16. Score

**79 / 100**

## 17. GO / NO-GO

**NO-GO.** See `POSTBUS_FINAL_GO_NO_GO.md`.

## 18. Production deployment checklist

See `POSTBUS_PRODUCTION_DEPLOYMENT_RUNBOOK.md`. Steps 8–16 require a later explicit approval.

## 19. Rollback plan

Revert application first. Keep columns. Do not DROP.

## 20. Exact files modified this phase (plus prior P0 files)

- `tsconfig.json`
- `components/orders/address-review-panel.tsx`
- `modules/labels/official-address.ts`
- `modules/labels/official-address.test.ts`
- `modules/labels/packing-fetch.ts`
- `modules/india-post/article-validator.ts`
- `modules/india-post/article-validator.test.ts`
- `modules/shopify/address-ai.ts`
- `modules/shopify/orders.ts`
- `modules/orders/service.ts`
- `modules/orders/historical-classify.ts`
- `modules/orders/historical-classify.test.ts`
- `modules/shopify/address-normalization.pg.test.ts`
- `supabase/migrations/20261030143000_shopify_address_normalization.sql`

Prior P0 files remain: shipping-contact, booking-run, shipments/service, address tests.

## 21. Git working tree

Branch `fix/auth-session-stability`. Uncommitted local work. **No commit. No push.** Large unrelated dirty tree left untouched except files listed.

## 22. Confirmation that production remains unchanged

- Production DB unchanged  
- No production migration  
- No deployment  
- No production booking  
- No production barcode allocation  
- No Git commit  
- No Git push  
