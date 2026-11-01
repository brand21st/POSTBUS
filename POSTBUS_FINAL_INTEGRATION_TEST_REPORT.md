# POSTBUS Final Integration Test Report

Date: 2026-10-30

## Scope actually executed

Synthetic unit / PGlite / mock tests only. **No live Shopify store. No live India Post CEPT. No production webhook replay. No browser UI against isolated staging** (`:3001` down). `npm run dev` on `:3000` is bound to **production** `.env.local` and was not used for mutation smoke.

## Shopify (fixtures / mocks)

Command (this session):

`npx vitest run modules/shopify/address-normalization.pg.test.ts modules/shopify/shipping-contact.test.ts modules/shopify/p0-address-safety.test.ts modules/shopify/booking-guard.test.ts modules/shopify/orders.test.ts …` plus address/booking/auth files.

**14 files, 196 tests, all passed.**

Covered in code tests (not live HTTP):

- Webhook mapping, payment evidence, fulfillment tracking URLs
- GraphQL empty mailing address must not wipe webhook street (`mergeShopifyRemoteOrder`)
- Duplicate / skip fulfilled imports
- Shopify pending payment booking block
- Manual override / NULL provenance blocks refresh (`shopifyMayRefreshStoredAddress`)
- Booking eligibility READY-only (`shippingAddressBookingBlock`)

**NOT EXECUTED live:** orders/create, orders/updated, concurrent store sync, development-store import.

## Address normalization

Unit coverage: `shipping-contact`, `p0-address-safety`, `historical-classify`, `address` (orders), `address-lines`, `official-address`.

Rules verified in code: no invented phones/names; PIN not padded; AI optional and not on webhooks; merchant override and NULL provenance skip Shopify overwrite; booked shipping not editable through review helpers.

**AI failure path / Unicode locales:** unit only, not a live OpenRouter call.

## Address review

P0 tests for accept / restore / revalidate / override. **No UI click-through** of Accept / Restore / Revalidate / Manual edit on staging.

## India Post booking

Mocks only (`INDIA_POST` not called).

Order of `runIndiaPostBooking` (source): Shopify guard → payment pending → **address gate** → **then** `allocateNextBarcode` → claim → payload → persist.

Bulk validate: already-booked skip; address block records `barcode: ""`.

`createShipmentsForOrders` skips enqueue when address is ineligible.

Booking-dimensions: 12/12 after READY fixtures.

## Barcode allocation

Code-order verified as above. Invalid address `continue`s before allocate. **No production barcode cursor was read or advanced.**

## Labels

`official-address.test.ts` passed. Unicode/PDF/bulk/custom **not** visually re-checked in a browser this run.

## UI regression

**NOT EXECUTED** on isolated staging. Would require `npm run dev:staging` with 54321 + 4099 up. Exercising `:3000` would hit production data.

## Security

- Production vs staging URL guards: `lib/env/staging-isolation.ts` tests passed.
- RLS: `addresses` already enabled in historical migration; this SQL does not drop policies.
- Cross-tenant HTTP: **NOT EXECUTED**.
- Shopify-dev project was not queried.

## Historical impact

**Production counts: NOT INSPECTED** (would be a production read of merchant addresses). Do not invent numbers.

Expected after migration on any real DB: booked and legacy rows `address_validation_status` NULL; unbooked until merchant Revalidate or a Shopify-managed (`override = false`) refresh. Revalidate keeps override when true or NULL.
