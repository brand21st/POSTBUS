# POSTBUS End-to-End Test Report

**Date:** 30 October 2026

## Executed

### Unit / PGlite (related suites)

```
npx vitest run modules/shopify/shipping-contact.test.ts
  modules/shopify/orders.test.ts modules/orders/address.test.ts
  modules/shopify/p0-address-safety.test.ts
  modules/shopify/address-normalization.pg.test.ts
  modules/orders/historical-classify.test.ts
  modules/labels/official-address.test.ts
  modules/india-post/article-validator.test.ts
  modules/india-post/address-lines.test.ts
  modules/shopify/graphql/orders.test.ts
  lib/phone/india-whatsapp.test.ts
```

First combined run while `next build` was occupying the machine: **142 passed, 1 failed** (`stores Shopify payment evidence on import` timed out at 5s).

Re-run alone after the build process ended:

```
npx vitest run modules/shopify/orders.test.ts -t "stores Shopify payment evidence"
```

**1 passed.** Treat the timeout as resource contention, not a product regression.

PGlite migration file: **3 passed**.

### TypeScript

```
NODE_OPTIONS=--max-old-space-size=16384 npx tsc --noEmit --incremental false
```

**Passed** after:

- Removing extra `.next-*` type roots from `tsconfig.json` (generated trees, not app source).
- Fixing `Button variant="outline"` on `address-review-panel.tsx`.

8GB heap still OOM before that tsconfig change.

### Next.js production build

```
NODE_OPTIONS=--max-old-space-size=16384 npx next build
```

- Compile: **succeeded** (~2.5 min).
- Embedded `Running TypeScript ...`: **OOM at ~16 GB**. Exit 1. **Build not complete.**

## Not executed (do not treat as passed)

| Test | Status |
| --- | --- |
| Live Shopify import / webhooks | NOT EXECUTED |
| Hosted staging app smoke | NOT EXECUTED |
| Production CEPT booking | Forbidden |
| Production barcode allocate | Forbidden |
| 100–10,000 order load | NOT EXECUTED |
| Cross-tenant HTTP | NOT EXECUTED |
| OpenRouter live | NOT EXECUTED |
| Full-repo ESLint | NOT EXECUTED |
| Historical classify against merchant data | NOT EXECUTED (unit only) |

## Mapping of requested E2E cases to what actually ran

| Case | How verified |
| --- | --- |
| GraphQL null shipping | Unit merge tests |
| Override vs sync | `shopifyMayRefreshStoredAddress` + review tests |
| Accept / restore / revalidate | `modules/orders/address.test.ts` |
| Booking eligibility | `shippingAddressBookingBlock` tests |
| Barcode order | Source-order assertion in `booking-run.ts` |
| Label line3 | `officialAddressLines` unit test |
| PIN 000000 | article-validator unit test |
| Historical classify dry-run | unit test |
| Migration populated | PGlite |
