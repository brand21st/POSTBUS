# POSTBUS Staging Migration Report

**Date:** 30 October 2026  
**Environment used:** In-process PGlite (isolated Postgres WASM). Host `n/a`. Database name: PGlite memory.

**Hosted staging:** NOT USED. `.env.staging.example` still has a placeholder project. Applying SQL to `.env.local` / production Supabase (`hgacoeoovjxkzfbesmvl`) is forbidden.

**Local `127.0.0.1:55432` PostBus staging Postgres:** NOT REQUIRED for this proof; PGlite applied the same SQL file.

## Isolation checks

| Check | Result |
| --- | --- |
| Not production Supabase ref | VERIFIED (PGlite has no supabase.co host) |
| Not `app.indiapost.gov.in` | VERIFIED |
| No production webhook | VERIFIED (no network) |
| No production CEPT | VERIFIED |
| Reversible | VERIFIED (process memory discarded) |

## Command

```
npx vitest run modules/shopify/address-normalization.pg.test.ts
```

**Result:** 3 passed.

## Before / after (synthetic populated tables)

| Object | Before | After |
| --- | --- | --- |
| Booked address `line1` | Booked House | Booked House |
| Booked `address_validation_status` | (column absent) | NULL |
| Booked `address_manual_override` | (absent) | NULL (protected) |
| Merchant-edited address `line1` | Merchant Corrected | Merchant Corrected |
| Merchant-edited override | (absent) | TRUE (audit backfill) |
| Legacy unknown override | (absent) | NULL |
| Booked barcode | ET214330016IN | ET214330016IN |
| Order IDs | unchanged | unchanged |
| Re-apply migration | — | 3 address rows still |

New Shopify-managed insert after migration defaulted `address_manual_override` to **false**.

## Hosted / Coolify staging

**NOT EXECUTED.** Identity of a shared hosted staging DB was not positively approved as isolated-and-authorized for this write.

## Recovery

No DROP. Failed apply would leave PGlite process dead; no customer data exists there.
