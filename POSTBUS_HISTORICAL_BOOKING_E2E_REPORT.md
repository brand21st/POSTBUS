# PostBus historical booking E2E

Date: 2026-10-31  
Code: `ensureLegacyAddressValidation` in `modules/orders/historical-classify.ts`, called from `modules/india-post/booking-run.ts` before `shippingAddressBookingBlock`.

## Concurrency fix (this pass)

- Persist only while `address_validation_status IS NULL` and snapshot `line1/city/pincode/phone` still match.
- Return the **database** row (or reload on 0-row update). Do not book from an in-memory unpersisted patch.
- Throw `legacy-address-id-required` when `id` is missing.

## Authenticated staging (user JWT + PostgREST)

Command: `npx tsx scripts/staging/historical-booking-e2e.mjs`  
**20/20 passed**. Exit 0. No barcode allocation. No live CEPT.

Covered:

1. Legacy valid → READY, street unchanged, booking gate open  
2. Legacy invalid phone → not READY, gate blocked  
3. Legacy invalid PIN → INVALID  
4. Missing recipient → not READY  
5. Missing street does not fabricate a READY street  
6. City present classified  
7. Long address classified  
8. Merchant `address_manual_override=true` preserved  
9. Concurrent classify stays READY  
10. Org B cannot read Org A address  

Not executed as live booking workers: database update failure injection, barcode claim race through CEPT stub, timeout, partial bulk.

## Unit / memory booking

`npx vitest run modules/orders/historical-classify.test.ts modules/india-post/booking-idempotency.test.ts`  
After mock updates: **50 passed** (combined with `shipping-contact.test.ts` in that run).

Includes: valid NULL books after classify; invalid PIN does not call CEPT.

## Verdict

**HISTORICAL CLASSIFY API E2E: PASS**  
**FULL INDIA POST BOOKING WORKER E2E (manual/bulk/retry/background): NOT COMPLETE**
