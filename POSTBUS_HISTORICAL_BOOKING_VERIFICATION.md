# PostBus historical booking verification

Date: 2026-10-31

## What is verified

Code path `ensureLegacyAddressValidation` persists only when `address_validation_status` is NULL and snapshot fields still match, then reloads the stored row.

Earlier this session, against local GoTrue user JWTs (not the browser):

`npx tsx scripts/staging/historical-booking-e2e.mjs` → **20/20**

Valid NULL → READY without rewriting street; invalid phone/PIN/recipient blocked; override preserved; Org B cannot read Org A. No barcode. No CEPT.

Unit: `historical-classify.test.ts` + `booking-idempotency.test.ts` passed in the prior run (50 with shipping-contact).

## What is not verified through the app

Staging Org A has **zero orders**. Cases A–J were not driven through `/dashboard/orders` booking UI or the worker against the CEPT stub.

The production figure of 13,661 unposted orders was a historical snapshot. It was not re-counted. Those orders were not reprocessed.

## Verdict

**HISTORICAL CLASSIFY API: PASS (prior isolated run)**  
**HISTORICAL BOOKING THROUGH THE APP: NOT EXECUTED**
