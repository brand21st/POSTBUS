# PostBus Shopify import E2E report

Date: 2026-10-30  
Scope: local unit / in-process tests. No live Shopify Admin GraphQL. No production webhooks.

## What ran

Command:

```
npx vitest run modules/shopify/p0-address-safety.test.ts modules/shopify/shipping-contact.test.ts modules/shopify/booking-guard.test.ts modules/shopify/orders.test.ts modules/shopify/address-normalization.pg.test.ts modules/orders/historical-classify.test.ts modules/orders/address.test.ts …
```

Focused suite (17 files including India Post / labels / isolation): **284 passed**, 0 failed, exit 0, ~3.3s.

Shopify-related files in that run: `p0-address-safety`, `shipping-contact`, `booking-guard`, `orders`, `address-normalization.pg` (PGlite), plus `modules/orders/address` and `historical-classify`.

## What did not run

| Import entry point | App-route / webhook E2E on :3001 |
| --- | --- |
| Initial import | Not executed (no Shopify mock Admin API wired to 3001) |
| Manual synchronization | Not executed |
| Background synchronization | Not executed (no isolated job drain against staging Auth) |
| `orders/create` webhook | Not executed |
| `orders/updated` webhook | Not executed |
| Duplicate / out-of-order webhooks | Unit coverage only, not HTTP |
| Partial GraphQL / protected customer data | Unit (`p0-address-safety`, `shipping-contact`) |
| Empty shipping address | Unit |
| Merchant override vs genuine update | Unit + SQL fixtures on 55432 |
| Concurrent sync | Not executed on the app |

Staging runtime has empty `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` by design (`assertLocalStagingProviderIsolation`). The app will not call Shopify. That is isolation, not import E2E.

## Persistence claim

Do **not** treat the 284 tests as Shopify import against `postbus_staging`. Address-normalization `.pg` tests use PGlite. Live inserts through Next API routes did not occur because GoTrue/PostgREST on 54321 is down.

## SQL fixtures (55432, not via Shopify)

| Address line1 | `address_manual_override` | `address_validation_status` |
| --- | --- | --- |
| Booked House | NULL | NULL |
| Merchant Corrected | TRUE | NULL |
| Unknown provenance | NULL | NULL |

These rows were not created by this session’s Shopify importer. They confirm migrated columns and synthetic data still present.

## Gate

**Shopify import E2E: FAIL** (service-level tests only; no authenticated app import path).
