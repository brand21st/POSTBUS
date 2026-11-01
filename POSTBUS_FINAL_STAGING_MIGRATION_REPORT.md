# POSTBUS Final Staging Migration Report

Date: 2026-10-30  
Branch: `fix/auth-session-stability`

## Isolation verdict (updated 2026-10-30 evening)

**STAGING ENVIRONMENT VERIFIED** for the local Patch-1 cluster:

- Host `127.0.0.1`, port **55432**, database **`postbus_staging`**, user `postbus_staging`
- `inet_server_addr=127.0.0.1`, `inet_server_port=55432`
- CEPT stub `http://127.0.0.1:4099` `PROVIDER_MODE=STUB` (`/health` ok, mock login returns `LOCAL_TEST_TOKEN`)
- Production `:3000` left running (pid **49940** unchanged)
- Production Supabase `hgacoeoovjxkzfbesmvl` was not used
- `127.0.0.1:54321` (unused Next staging URL) still **not listening** — `npm run dev:staging` was **not** started, so the Next process would not talk to a missing API or to production

**Hosted / Coolify staging:** still **NOT USED**.

**Isolated PGlite proof:** still VERIFIED from the earlier unit file.

## Environment identities (non-secret)

| Target | How identified | Result |
| --- | --- | --- |
| Production | `.env.local` → `*.supabase.co` host matching `PRODUCTION_SUPABASE_REF` | **Do not migrate.** `npm run dev` on :3000 uses this. |
| Intended local staging | `.env.staging.local`: `POSTBUS_ENV=staging`, app `127.0.0.1:3001`, Supabase URL host `127.0.0.1:54321`, India Post `127.0.0.1:4099`, Shopify API key empty | Gate script `assert-hosted-ready.mts` **exit 0** (loopback allowed). **TCP 54321 not listening.** CEPT stub **4099 not listening.** Staging app **3001 not listening.** |
| Local Patch-1 Postgres | `127.0.0.1:55432` | **Not listening.** |
| Unknown local Postgres | `127.0.0.1:54322` process `postgres` | **Not used.** Identity and dataset not proven test-only. |
| Shopify cloud-dev | `.env.shopify-local` project ref `faanzcrnfndttbjpmlxu` | Separate from production. **Not authorized** as the address-normalization staging target in this run. |
| Hosted Coolify staging | No approved non-production Supabase ref in `.env.staging.local` | **Not used.** |

`npm run staging:hosted-gate` against `.env.staging.local`: **ok**, `projectRef: non-supabase-host`. That only proves the *file* is not production. It does not prove a running isolated database exists.

## Why SQL was not applied to a shared database

Mandatory conditions 1–5 were not all met for any remote or local listening Postgres:

1. Staging positively identified as a live DB — **fail** (54321 down).
2. Separate from production — config file yes; live DB no.
3. Only approved test data — **unknown** for 54322 / Shopify-dev cloud.
4. Scope understood — yes (see SQL audit).
5. Explicit staging-write authorization for that database — **not present.**

Applying `20261030143000_shopify_address_normalization.sql` to production, to `faanzcrnfndttbjpmlxu`, or to unidentified `54322` was refused.

## SQL pre-flight (`20261030143000_shopify_address_normalization.sql`)

| Check | Result |
| --- | --- |
| Additive columns | `IF NOT EXISTS` / nullable status |
| Tri-state override | NULL legacy, true merchant, false new default |
| Legacy protection | `UPDATE … SET override = null WHERE override is false AND original_shipping is null` |
| Audit backfill | `order.shipping_address_updated` → override true |
| Does not rewrite line1/phone/barcode | Confirmed: no updates to those columns |
| Booked shipments | Untouched |
| Constraint | status NULL or READY / NEEDS_REVIEW / INVALID |
| Indexes | partial org indexes |
| RLS | No policy drop; existing `addresses` RLS remains |
| Idempotent | `IF NOT EXISTS` + constraint drop/add; PGlite apply-twice passed |
| Long locks | Two `UPDATE`s on `addresses` (second joins orders+audit_logs). On a large production table this can take minutes; needs a maintenance window. No `VACUUM FULL` / `DROP`. |

## Isolated apply (PGlite)

Command: `npx vitest run modules/shopify/address-normalization.pg.test.ts`  
**3 passed** (this session).

| Object | Before | After |
| --- | --- | --- |
| Booked `line1` | Booked House | Booked House |
| Booked validation status | (no column) | NULL |
| Booked override | (no column) | NULL |
| Merchant-edited line1 | Merchant Corrected | Merchant Corrected |
| Merchant-edited override | (no column) | true (audit) |
| Legacy override | (no column) | NULL |
| Booked barcode | ET214330016IN | ET214330016IN |
| Address row count after re-apply | 3 | 3 |
| New insert with `original_shipping` | — | override false |

## Local cluster apply (this session)

`npm run staging:up` then official file `20261030143000_shopify_address_normalization.sql` via `psql` to **55432 only**.

| Object | Before | After |
| --- | --- | --- |
| orgs | 3 | 3 |
| orders | 2 | 2 |
| addresses | 3 | 3 |
| booked shipments | 1 | 1 |
| barcodes | 1 | 1 |
| booked `line1` | Booked House | Booked House |
| booked barcode | ET214330016IN | ET214330016IN |
| booked status | BOOKED | BOOKED |
| booked override / validation | (columns absent) | NULL / NULL |
| merchant-edited override | (absent) | true |
| merchant-edited `line1` | Merchant Corrected | Merchant Corrected |
| legacy override | (absent) | NULL |
| re-apply | — | still 3 addresses |

Shopify + mock India Post tests this session: **10 files, 186 passed**. Live CEPT.gov was not called.

## Hosted staging snapshot

**NOT EXECUTED.** Organization / order / barcode counts for a hosted Supabase staging project were not queried.

## Recovery

No DROP. Failed PGlite apply dies with the process. Hosted rollback: keep columns; do not DROP while the new app is live (expand/contract).
