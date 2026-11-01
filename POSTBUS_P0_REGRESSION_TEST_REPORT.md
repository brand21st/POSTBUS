# POSTBUS P0 Regression Test Report

**Date:** 30 October 2026  
**Command executed:**

```
npx vitest run modules/shopify/shipping-contact.test.ts \
  modules/shopify/orders.test.ts modules/orders/address.test.ts \
  modules/shopify/graphql/orders.test.ts \
  modules/india-post/article-validator.test.ts \
  modules/india-post/address-lines.test.ts \
  lib/phone/india-whatsapp.test.ts \
  modules/shopify/p0-address-safety.test.ts
```

## Executed

| Result | Count |
| --- | --- |
| Passed | **135** |
| Failed | **0** |
| Skipped | **0** |
| Files | 8 passed |
| Duration | 1.28s |

This is 19 more tests than the audit baseline of 116.

## P0 coverage (executed)

| ID | Test | Result |
| --- | --- | --- |
| P0-01 | Accept valid suggestion | Passed |
| P0-01 | Invalid phone/PIN/city/name/long address rejected | Passed |
| P0-01 | Concurrent accept conflict | Passed |
| P0-02 | `shopifyMayRefreshStoredAddress` legacy/override/new | Passed |
| P0-03 | GraphQL empty mailingAddress merge | Passed |
| P0-03 | Partial GraphQL keeps previous ZIP/phone | Passed |
| P0-04 | `booking-run.ts` source order: gate before `allocateNextBarcode` | Passed |
| P0-05 | Revalidate keeps override and does not write line1 | Passed |
| P0-06 | Restore original fields + matching READY | Passed |
| P0-06 | Restore invalid original stays INVALID | Passed |
| P0-06 | Restore booked blocked | Passed |
| P0-07 | READY+valid, READY+invalid, NEEDS_REVIEW, INVALID, NULL, UNKNOWN, missing | Passed |
| P0-08 | Persistence includes all new columns | Passed |

## Other executed (not claimed as P0)

Existing phone/PIN/normalization/AI hallucination unit tests in the suites above still passed.

## Not executed

| Test | Reason |
| --- | --- |
| `tsc --noEmit` | Process OOM (heap limit). **NOT EXECUTED** |
| Full ESLint repo | Not run. Touched files: `npx eslint` on 7 files **passed** (exit 0) |
| Next.js build | **NOT EXECUTED** |
| Migration on populated staging DB | **NOT EXECUTED** (no approved isolated DB) |
| Old app + new schema | **NOT EXECUTED** |
| Live Shopify webhook replay | **NOT EXECUTED** |
| Live barcode allocate | Forbidden |
| India Post booking API | Forbidden |
| Cross-tenant HTTP | **NOT EXECUTED** |
| Load 100–10,000 orders | **NOT EXECUTED** |
| OpenRouter live timeout | **NOT EXECUTED** |

Do not treat 135 passing unit tests as staging or production verification.
