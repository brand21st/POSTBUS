# PostBus Shopify + India Post final E2E

Date: 2026-10-31  
Staging app: `127.0.0.1:3001` (`POSTBUS_ENV=staging`, Shopify keys empty, CEPT stub `127.0.0.1:4099`).

## Shopify

Command: `npx vitest run modules/shopify/p0-address-safety.test.ts modules/shopify/shipping-contact.test.ts modules/shopify/orders.test.ts modules/shopify/booking-guard.test.ts`  
**Included in 134 passed / 6 files** with labels + booking-lock.

Covered in unit tests: mapping, override protection, booking guard, order helpers.  
**Not executed** on authenticated staging with mock Shopify HTTP:

- orders/create and orders/updated webhooks  
- Duplicate / out-of-order webhooks  
- GraphQL protected customer data unavailable  
- Background sync worker  
- Persistence proof of a new imported order row via the Next app  

No live Shopify mutation.

## India Post

CEPT stub health: `{"ok":true,"provider_mode":"STUB"}`.  
Booking safety: `booking-idempotency.test.ts` + `booking-lock.test.ts` (unit).  
Authenticated classify E2E did **not** allocate barcodes or POST articles.

**Not executed:** manual/bulk/retry/background booking through the staging UI or worker against the stub with real shipment rows.

## Labels / UI

`modules/labels/custom-label.test.ts` passed in the 134-test run.  
Browser: login page only; dashboard/orders/labels **not** reached because UI login failed to fetch GoTrue.

## Verdict

**SHOPIFY UNIT: PASS**  
**SHOPIFY AUTHENTICATED APP E2E: NOT EXECUTED**  
**INDIA POST STUB REACHABLE: PASS**  
**INDIA POST AUTHENTICATED BOOKING E2E: NOT EXECUTED**  
**LABEL UNIT: PASS**  
**LABEL BROWSER: NOT EXECUTED**
