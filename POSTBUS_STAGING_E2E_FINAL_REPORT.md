# PostBus Final Staging E2E + Real PostgreSQL Concurrency + Production Migration Dry Run

**Date:** 2026-11-01  
**Production writes:** none. **Production migrations applied:** none. **Shopify HTTP:** none. **Live India Post:** none.

## Verdict

**BLOCKED — ADDITIONAL VALIDATION REQUIRED** for a full Next.js/PostgREST Shopify webhook E2E.

**Unblocked this session:** dual-session PostgreSQL concurrency on isolated staging, booked AWB protection, invoice freeze, cross-tenant RPC denial, and a print-only production migration dry run.

## Isolation

| Target | Used |
|---|---|
| Production `hgacoeoovjxkzfbesmvl` | Read-only column/migration list only |
| Staging Postgres | `127.0.0.1:55432` / `postbus_staging` **writes** |
| `npm run dev` `:3000` | **Not used** (live Next; do not inject test orders) |
| Staging Next `:3001` | **Not started** (`.env.staging.local` points at `127.0.0.1:54321`, which is down) |
| CEPT stub `:4099` | Started, `PROVIDER_MODE=STUB` |

## 1. Staging E2E fixtures

Command: `node scripts/staging/shopify-e2e-fixtures.mjs`

| Scenario | Result |
|---|---|
| 1 Partial: only replacement LineItem GID B | **PASS** |
| 2 Fully paid: one active line | **PASS** |
| 3 COD amounts 0 / 499 / 499 | **PASS** |
| 4 Booked: RPC `skipped_locked`, AWB `ET214330016IN` unchanged | **PASS** |
| 7 Existing FINALIZED invoice totals/lines unchanged after line replace | **PASS** |
| 8 Tenant B cannot replace Tenant A order | **PASS** |

Shopify Admin HTTP import through Next **NOT EXECUTED**.

## 2. Real PostgreSQL concurrency

Command: `node scripts/staging/shopify-pg-concurrency.mjs`

Two concurrent `psql.exe` sessions called `replace_shopify_order_line_items` on the same order (1-line vs 2-line payloads).

| Field | Value |
|---|---|
| Result | **PASS** |
| Elapsed | 68 ms |
| Session A | `replaced` count 1 |
| Session B | `replaced` count 2 |
| Final rows | GID 2 and GID 9 only (complete winner B; **not mixed**) |

This is real two-connection PostgreSQL, not PGlite.

## 3. Production migration dry run

Command: `node scripts/staging/production-migration-dry-run.mjs`  
Plus read-only production `information_schema` / `schema_migrations`.

| Item | Production now | Dry-run conclusion |
|---|---|---|
| `source_line_item_id` | **Missing** | Must add before app deploy |
| `unfulfilled_quantity` | **Missing** | Must add before app deploy |
| `requires_shipping` | **Missing** | Must add before app deploy |
| `20261029120001` | **Not applied** | Additive; no unique line-item index; **do not apply in this session** |
| `20261101090000` | **Not applied** | Additive columns IF NOT EXISTS + RPC; **do not apply in this session** |
| `applyNow` | false | Backup → staging (done) → PostgREST reload → production |

SQL review: no `DROP TABLE` / unique on `source_line_item_id`. Function contains `DELETE FROM order_line_items` **scoped to one org+order** inside a transaction.

**This dry run did not open a production write connection.**

## 4. India Post stub

`node scripts/staging/cept-stub.mjs` listening `http://127.0.0.1:4099`. No barcode allocation against production ranges.

## Remaining production blockers

1. Apply pending additive migrations on production **after explicit approval**.
2. Reload PostgREST, then deploy app+workers together.
3. Optional: Shopify **dev store** webhook against isolated Next+PostgREST (`:3001` + `:54321`), not `www.postbus.in` / `:3000`.

No commit, push, or production deploy.
