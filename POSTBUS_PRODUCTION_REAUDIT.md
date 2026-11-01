# POSTBUS Production Re-Audit (after P0 fixes)

**Date:** 30 October 2026  
**Previous audit:** `POSTBUS_SHOPIFY_PRODUCTION_READINESS_AUDIT.md` (47/100, NO-GO)

## Overall

**READY WITH CONDITIONS**  
**Score:** **74 / 100**  
**Recommendation:** **NO-GO for production until staging migration and smoke tests complete.**

The eight P0 code defects are addressed. Production is still blocked by unverified migration apply, unverified rollout ordering, and open P1 items (AI cost/latency, label line3).

## P0 re-audit

| ID | Original root cause | Verification | Status |
| --- | --- | --- | --- |
| P0-01 | Accept forced READY | Unit tests reject invalid/review; valid accept writes classified READY | FIXED AND VERIFIED |
| P0-02 | Override default false on all rows | Migration tri-state + refresh skip; SQL not applied anywhere | FIXED BUT NOT FULLY VERIFIED |
| P0-03 | GraphQL replaced webhook remote | Merge unit tests; webhook path now `mergeShopifyRemoteOrder` | FIXED AND VERIFIED |
| P0-04 | Allocate then address throw | Source-order test + fail-closed gate; no live allocate | FIXED AND VERIFIED |
| P0-05 | Revalidate used `shopifyAddressPersistence` override false | Override path classifies in place | FIXED AND VERIFIED |
| P0-06 | Raw street + cleaned status | Restore classifies restored fields | FIXED AND VERIFIED |
| P0-07 | Gate ignored NULL | Fail-closed unit tests | FIXED AND VERIFIED |
| P0-08 | Insert new columns pre-migration | Documented schema-first; no staging apply | FIXED BUT NOT FULLY VERIFIED |

## New regressions found

None in the executed unit suites (135/135).

## Conditions still required

1. Apply `20261030143000_shopify_address_normalization.sql` to isolated staging and inspect existing `addresses.address_manual_override` (expect NULL except audit-backed true).
2. Deploy app only after columns exist.
3. Confirm one READY book and one NULL/INVALID skip without barcode cursor movement.
4. Do not enable OpenRouter address AI at scale until P1-01/P1-02.

## Score rationale

| Area | Points (max) | Awarded |
| --- | --- | --- |
| Mapping (no invented phone/PIN/name) | 15 | 15 |
| P0 review/booking/sync code | 40 | 36 |
| Migration proven | 15 | 6 |
| Tests beyond unit | 15 | 8 |
| P1 operational safety | 15 | 9 |
| **Total** | **100** | **74** |
