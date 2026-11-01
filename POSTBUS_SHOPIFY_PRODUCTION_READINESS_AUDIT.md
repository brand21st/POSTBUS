# PostBus Shopify Partial-Payment Fix — Production Readiness Audit

**Date:** 2026-10-31  
**Mode:** Validation, schema audit, safe automated tests.  
**Production writes:** none. **Migrations applied:** none. **Shopify mutations:** none. **India Post bookings:** none. **Historical repair:** none. **Git commit/push:** none.

Production identity (read-only MCP / `information_schema`): project `hgacoeoovjxkzfbesmvl` (`https://hgacoeoovjxkzfbesmvl.supabase.co`).

---

## 1. Executive Summary

The local `currentQuantity` import fix is **internally consistent** and the targeted unit tests **PASS**. It is **not safe to deploy to production as the working tree exists today**.

**CONFIRMED P0:** Production `order_line_items` still lacks `source_line_item_id`, `unfulfilled_quantity`, and `requires_shipping`. Migration `20261029120001_shopify_fulfillment_eligibility.sql` is **not applied**. The current importer always sends those three keys on insert (`shopifyLineItemRows`). Modern PostgREST rejects unknown JSON columns (`PGRST204`) unless `?columns=` whitelists known fields. Deploying this application code **before** the additive migration is **incompatible** with the live schema.

**CONFIRMED P0:** Isolated staging that can import a Shopify order was **not available**. Local API `127.0.0.1:54321` is closed, `npm run dev:staging` port `3001` is closed, India Post stub `4099` is closed. Production was not used as a substitute.

**Verdict:** **BLOCKED — ADDITIONAL VALIDATION REQUIRED**

---

## 2. Current Implementation Status

Working tree matches `SHOPIFY_PARTIAL_PAYMENT_FIX_IMPLEMENTATION.md`:

| Capability | Status |
|---|---|
| Filter `currentQuantity` / `current_quantity` > 0 | Present (`modules/shopify/line-items.ts`) |
| Skip edited orders missing current quantity | Present |
| Operational total from `current_total_price` | Present |
| PARTIAL `amount_paid` = current − outstanding | Present |
| COD from outstanding | Present |
| Booked/queued line rewrite lock | Present (`SHOPIFY_WEIGHT_LOCKED_*`) |
| No historical repair | Confirmed (no repair job) |
| Unique `(order_id, source_line_item_id)` | **Not added** (correct; 333 duplicate title/SKU groups exist) |

---

## 3. Database Schema Compatibility Matrix

| Environment | How verified | `source_line_item_id` | `unfulfilled_quantity` | `requires_shipping` | Migration `20261029120001` | App insert compatibility |
|---|---|---|---|---|---|---|
| **Production** `hgacoeoovjxkzfbesmvl` | Read-only `information_schema` + `schema_migrations` **this session** | **Missing** | **Missing** | **Missing** | **Pending** (not in applied list; latest includes `20261031054133`) | **Incompatible** with current `shopifyLineItemRows` payload |
| **Local Docker** `postbuslocal` (ports 54321/54332) | Port scan | **Unknown** (API/DB **not running**) | Unknown | Unknown | Unknown on live DB; **present in repo** | Unverified |
| **Staging** `.env.staging.local` → `http://127.0.0.1:54321` | File exists, `POSTBUS_ENV=staging`, not production URL | **Unknown** | Unknown | Unknown | Unknown | **Unverified** — target API **down** |
| **Bootstrap PG** `127.0.0.1:55432` | Port listening only | **Unknown** | Unknown | Unknown | Unknown | Not used (not proven equivalent to app schema) |

Production `order_line_items` constraints (read-only): PK on `id`, FKs, `CHECK (quantity > 0)`. **No unique line identity.** Nullable extra columns would be additive and backward compatible for **old** app versions that omit them.

PostgREST: extra JSON keys are ignored **only** when `?columns=` lists the allowed set. supabase-js inserts send the full object. After PostgREST schema-cache enforcement, unknown keys fail the request (**LIKELY** `PGRST204` on this stack; live extra-column POST was **not** executed against production).

A production postgres log this session (`column li.source_line_item_id does not exist` at 2026-10-31T12:02:48Z) is **LIKELY** from the earlier audit SELECT, not from merchant inserts. Do not treat it as proof that production app already sends the column.

---

## 4. Migration Requirements

**Required before this application code can persist line items on production.**

File: `supabase/migrations/20261029120001_shopify_fulfillment_eligibility.sql`

- Additive `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` (nullable).
- Also creates `shopify_shipment_allocations` (needed for FO allocation, not strictly for the currentQuantity filter).
- **Does not** unique-index historical duplicates.
- **Rollback of columns:** leave in place; old app ignores them. Do not drop after app deploy.

**Recommended rollout (not executed):**

1. Backup / confirm PITR for `hgacoeoovjxkzfbesmvl`.
2. Apply the migration on an **isolated staging clone** first.
3. Reload PostgREST schema cache.
4. Deploy application to staging; import a PARTIAL edited order.
5. Apply the same migration on production.
6. Confirm cache reload.
7. Deploy application.
8. Do **not** run historical line-item repair in the same change.

**Do not deploy the app first.** Old workers without the three insert keys can coexist **after** the migration (they write nulls). New workers **cannot** coexist **before** the migration.

---

## 5. Shopify Partial Payment Validation

Illustrative target (₹1049 current, ₹734.30 outstanding, ₹314.70 paid):

| Check | Result |
|---|---|
| Formula `1049 − 734.30 = 314.70` | **CONFIRMED** in `mapShopifyCollectable` |
| Unit fixture used in tests | Live-shaped **₹4296 / ₹3037.20 / ₹1258.80** — **PASS** |
| Live Shopify + PostBus staging import of ₹1049 case | **NOT EXECUTED** |

Deposit exclusion (`current_quantity: 0` vs replacement GID) — **PASS** in `orders.test.ts` (`imports only currentQuantity > 0 lines after a partial-COD order edit`).

---

## 6. REST API Validation

| Item | Status |
|---|---|
| REST field `current_quantity` used | **PASS** (unit) |
| REST `current_total_price` used | **PASS** (unit) |
| Webhook re-read `GET /orders/{id}.json` when edited+missing qty or pending/authorized payment | **CONFIRMED** in `importShopifyWebhookOrder` L2826–2828 |
| Live REST against a Shopify **dev store** | **NOT EXECUTED** |

Extra REST calls: only when `shopifyPaymentNeedsRefresh` (missing/pending/authorized financial status) **or** `shopifyLineSnapshotNeedsRefresh`. Complete `partially_paid` payloads with `current_quantity` do **not** add a fetch. GraphQL app path already re-reads the order (pre-existing).

---

## 7. GraphQL API Validation

| Item | Status |
|---|---|
| Query includes `currentQuantity`, `edited`, `currentTotalPriceSet`, `currentSubtotalPriceSet` | **PASS** (`modules/shopify/graphql/orders.ts`) |
| Mapper keeps removed lines on the remote object; upsert filters them | **PASS** (mapper test + selector) |
| Live GraphQL against shops | **NOT EXECUTED** this session (done in the prior root-cause report only) |

---

## 8. Fully Paid Order Regression

Unit: paid import stores `payment_status: PAID`, `amount_paid: 10`, `cod_amount: 0` — **PASS**.  
Staging live paid order — **NOT EXECUTED**.

---

## 9. Normal COD Order Regression

Unit: `mapShopifyCollectable({ total_price: "499.00" }, "COD")` → `amountPaid: 0`, `codAmount: 499` — **PASS**.  
Merchant extra COD charge path not rewritten.  
Staging COD booking — **NOT EXECUTED**.

---

## 10. Partial Payment Regression

Unit PARTIAL current-total settlement — **PASS**.  
Dashboard/invoices consume stored `amount_paid` / `cod_amount` / line rows (no frontend-only filter) — **CONFIRMED** (`lib/dashboard/records.ts` sums stored quantities).

---

## 11. Edited Order Regression

| Case | Automated | Staging |
|---|---|---|
| Removed deposit excluded | **PASS** | **NOT EXECUTED** |
| Replacement included | **PASS** | **NOT EXECUTED** |
| Same SKU two active GIDs | **PASS** | **NOT EXECUTED** |
| Missing current qty skip | **PASS** | **NOT EXECUTED** |

---

## 12. Concurrent Sync Findings

**CONFIRMED (code):** `refreshShopifyLineItems` (`modules/shopify/orders.ts` **L1148–1156**) `DELETE` then `INSERT` without a single DB transaction / row lock.

**NOT VERIFIED (runtime):** overlapping webhook + `shopify-sync` producing extra rows. Sequential upserts in unit tests do not duplicate.

| Field | Value |
|---|---|
| Severity | **P1** |
| File | `modules/shopify/orders.ts` |
| Function | `refreshShopifyLineItems` |
| Lines | 1148–1156 |
| Evidence | Non-atomic two-round-trip; no unique identity on production |
| Impact | **POSSIBLE** duplicate active rows under concurrent delete/insert |
| Recommended fix | Postgres function `DELETE+INSERT` in one transaction keyed by `(organization_id, order_id)`, or `FOR UPDATE` on `orders` before refresh. Do **not** add a unique index until historical dups are cleaned. |
| Blocks deploy? | **No** as a demonstrated corruption this session; **accept explicitly** or fix before scale-out. |

Webhook retries: failed public-app imports are not recorded so Shopify retries (`lib/shopify-app/webhooks.test.ts`) — **PASS**.

---

## 13. Payment Reconciliation Findings

**`amount_paid` meaning (PARTIAL):** net settled against **current Shopify order total**, computed as `operationalTotal − outstanding`. It is **not** independently summed from capture transactions.

| Scenario | Expected vs implementation | Status |
|---|---|---|
| Partial, no refund, current total present | Matches capture in the Shop A sample (₹1258.80) | **PASS** unit; live **NOT EXECUTED** |
| Second capture / full pay | Financial status → `paid`; `settleOrderPayment` uses operational total | **PASS** mapping; sequence **NOT EXECUTED** |
| Order edit after partial capture | Uses current total | **PASS** unit |
| Partial/full refund | `partially_refunded` / `refunded` → `REFUNDED`, not PARTIAL formula | **PASS** unit |
| Authorization without capture | `authorized` → not PAID unless successful sale/capture | **PASS** unit |
| Payment adjustment / extra transaction mix | Formula ignores transaction sum | **LIKELY gap** — do not change without a separate finance spec |
| Discount after create | Relies on Shopify current totals | **PASS** mapping; money matrix **NOT EXECUTED** |

Downstream: dashboard, COD (`cod_amount`), new sales invoices (`amount_paid_paise`), shipments (`shipmentCollectFromOrder` for **unbooked** only). Booked AWB collect is not rewritten on conflict (audit log).

**Do not silently change this formula** until product defines “captured” vs “settled against current total”.

---

## 14. India Post Booking Safety

| Test | Result |
|---|---|
| A New PARTIAL uses active qty for parcel | **PASS** unit (selection before `shopifyParcelFromLineItems`) |
| B Booked shipment + Shopify update | **PASS** unit (lock + collect conflict); live **NOT EXECUTED** |
| C Product removed after booking | Lines **not** rewritten (**CONFIRMED** lock). Order **totals still update** on existing orders (**CONFIRMED** `upsertShopifyOrder` L2449–2454). Shipment COD **not** auto-rewritten if booked. |
| D Repeat webhook duplicate booking | Existing “already booked / no auto-book pending” tests **PASS**; live **NOT EXECUTED** |
| E Current total change vs booked COD | Unbooked collect refresh skipped when incomplete; booked conflict logged | **PASS** unit |

`createShipmentsForOrders` Shopify weight uses DB `unfulfilled_quantity` or **0** if null (`modules/shipments/service.ts` L289–297). Production column **missing** → JS `undefined` → **0 line weight**; parcel/manual grams still apply. **LIKELY** pre-existing; deploying identity columns later changes this path. Real India Post APIs were **not** called.

---

## 15. Invoice Safety

`createSalesInvoiceFromOrder` returns existing non-cancelled invoice and does not regenerate (`modules/sales-invoices/service.ts` L157–166). New invoices copy **current stored** `order_line_items`.

Read-only production: **0** of the 249 PARTIAL title/SKU-duplicate orders have a non-cancelled sales invoice.

New invoice after a successful line refresh: deposit lines absent — **PASS** by construction; dedicated invoice fixture **NOT EXECUTED**.  
Historical invoices: **protected**; none found on the duplicate PARTIAL set.

---

## 16. Historical Order Impact

Fresh read-only production counts (title+SKU duplicate groups; **not** LineItem-ID proof):

| Metric | Count |
|---|---|
| Shopify orders | 15,252 |
| PARTIAL Shopify orders | 443 |
| PARTIAL with duplicate title+SKU rows | **249** (same as prior audit) |
| All payment statuses with duplicate title+SKU | 333 |
| PARTIAL dups with **no** queued/booked/in-transit/delivered shipment | **234** |
| PARTIAL dups with booked-class shipment | **15** |
| PARTIAL dups queued / in-transit / delivered | 0 / 0 / 0 |
| PARTIAL dups cancelled order | 0 |
| PARTIAL dups with sales invoice | 0 |

**After a compatible deploy:**

- **A. 234 unbooked** — **LIKELY** self-correct on next `orders/updated` or background sync (`refreshShopifyLineItems`). Totals also move to current Shopify totals.
- **B. 15 booked** — lines **remain duplicated** (lock). **CONFIRMED** order header totals **can still change** on sync → header vs packing-slip inconsistency until a separate recovery.
- **C.** Background sync **will** rewrite operational totals for existing unlocked **and** locked-line orders (totals update is not gated on the weight lock).
- **D.** Invoice conflict: none on this set today; if invoices are generated **before** line refresh, they can snapshot duplicates (`createSalesInvoiceFromOrder` uses stored rows).
- **E.** Customer-facing: unbooked orders may **lose deposit rows and change totals** after deploy; booked orders may show **new totals with old extra products**.

**Recovery plan (proposal only, not executed):** dry-run Shopify GID/`currentQuantity` compare per tenant; apply line replace only to class A after backup; never mutate AWB; never rewrite invoices; booked class = display discrepancy or merchant-approved exception.

---

## 17. Multi-Tenant Security

Inserts/updates/deletes in the Shopify upsert path include `.eq("organization_id", ...)`. External refs use `(organization_id, source, source_order_id)`. Webhook import loads the connection for that organization.

Live cross-tenant attack test — **NOT EXECUTED**.  
Assessment: **PASS** at code review; **NOT VERIFIED** as a penetration test.

---

## 18. Performance Results

No load benchmark executed.

| Workload | Assessment |
|---|---|
| 1–100 lines | In-memory filter; **LIKELY** negligible |
| Repeated updates | Delete+insert all lines; pre-existing cost |
| Extra Shopify HTTP | 0 extra for complete PARTIAL payloads; +order+transactions GET for pending/authorized or missing current qty (custom OAuth); GraphQL full re-read for app installs (pre-existing) |
| N+1 | Not introduced for the filter itself |

---

## 19. Automated Test Results

| Command | Duration | Passed | Failed | Skipped | Status |
|---|---|---|---|---|---|
| `npx vitest run` Shopify line-items/payment/graphql/orders + `lib/shopify-app/webhooks.test.ts` + `modules/orders/payment.test.ts` + `modules/orders/shopify-payment-confirm.test.ts` + `modules/shipments/shopify-retry.test.ts` | 2.50s | **119** | 0 | 0 | **PASS** |
| `npx vitest run modules/sales-invoices/tax.test.ts schema.test.ts lib/env/staging-isolation.test.ts` | 0.17s | **17** | 0 | 0 | **PASS** |
| `npm run typecheck` | ~19.6s | — | 0 | — | **PASS** |
| `npx eslint` on Shopify implementation files | — | — | 0 | — | **PASS** (empty output, exit 0) |
| Full `npm test` | — | — | — | — | **NOT EXECUTED** |
| Live Shopify / India Post / Playwright | — | — | — | — | **NOT EXECUTED** |

---

## 20. Staging Validation Results

**STAGING NOT EXECUTED.**

Isolation check:

- `.env.staging.local` points at `http://127.0.0.1:54321` (not `hgacoeoovjxkzfbesmvl`) — **good if that stack is up**.
- `INDIA_POST_MOCK_MODE=true`, `SHOPIFY_MOCK_MODE=true`, Razorpay/WhatsApp disabled in the staging example.
- **This session:** 54321 closed, 54332 closed, 3001 closed, 4099 closed. Cannot import Shopify, book, or invoice on staging.

Production was **not** used as a write target. Read-only schema/count queries only.

**Deployment blocker:** no authorized isolated staging run of the ₹1049 / deposit-line scenario.

---

## 21. Remaining Risks

| ID | Severity | Confidence | Issue | Blocks? |
|---|---|---|---|---|
| R1 | **P0** | **CONFIRMED** | Production missing three line-item columns vs insert payload | **Yes** |
| R2 | **P0** | **CONFIRMED** | Staging integration not run | **Yes** |
| R3 | **P1** | **CONFIRMED** code / **POSSIBLE** runtime | Non-atomic DELETE+INSERT | Accept or fix |
| R4 | **P1** | **CONFIRMED** | Booked orders: totals update, lines stay duplicated | Accept or skip totals when locked |
| R5 | **P1** | **LIKELY** | 234 unbooked historical orders self-correct (totals + products) on first sync | Communicate; not auto-repair job |
| R6 | **P1** | **LIKELY** | `amount_paid` ≠ sum(captures) for adjustments | Spec, don’t change now |
| R7 | **P2** | **LIKELY** | Shopify weight uses missing `unfulfilled_quantity` → 0 | After migration, re-verify booking weight |
| R8 | **P2** | **POSSIBLE** | PostgREST cache lag after migrate (`PGRST204` for **new** columns until reload) | Reload cache in runbook |

---

## 22. Production Deployment Plan

**Do not execute until P0s are cleared.**

1. Stand up isolated staging (not production ref). Verify `staging:isolate`.
2. Apply `20261029120001` on staging only. Reload API schema.
3. Deploy this app to staging workers **and** web.
4. Run section 6–11 against a Shopify **dev** store (mock India Post).
5. Explicitly accept or patch R3/R4.
6. Production backup / PITR check.
7. Apply the **same** migration on production. Reload PostgREST.
8. Smoke a **new** PARTIAL import on a test shop if available; do not reprocess 249 historical orders.
9. Deploy app (web + workers together preferred).
10. Monitor (section 24). Rollback app if insert error rate spikes.

---

## 23. Rollback Plan

1. Redeploy previous application revision (columns remain nullable; old payload omits them).
2. **Do not** drop the three columns after a successful migrate.
3. **Do not** bulk-delete `order_line_items`.
4. If migration was the only change and app was not deployed, production behavior is unchanged.
5. Webhook subscriptions: unchanged by this work; do not revert them.

---

## 24. Monitoring Recommendations

Use existing `logError` / `logInfo` (fields are redacted in `lib/logger.ts`). Do **not** log tokens, addresses, phones, or payment credentials.

| Signal | Source | Threshold (proposal) | Action |
|---|---|---|---|
| `shopify.line_items.current_quantity_missing` | App logs | > 20/15m or any new-tenant spike | Check webhook payload / REST re-read failures |
| PostgREST `PGRST204` / “column … does not exist” | Postgres/API logs | **Any** after deploy | Rollback app or reload schema cache |
| Shopify import error rate | webhook + `shopify-sync` jobs | 2× baseline or >5% fail | Rollback |
| Duplicate title+SKU on **new** PARTIAL orders created after deploy | Nightly read-only SQL | > 0 new orders | Incident; do not auto-delete |
| `orders.total_amount` vs Shopify current total sample | Manual | Mismatch on new imports | Payment mapping review |
| India Post booking failures | Existing booking logs | Existing SLO | Unrelated unless weight=0 spike |
| Invoice generation failures | sales invoice jobs | Existing SLO | Confirm not rewriting old IDs |

Rollback trigger: Shopify line-item insert failures, or new PARTIAL orders missing products, or PGRST204 on `order_line_items`.

**Not enabled or changed in production this session.**

---

## 25. Production Readiness Gates

| Gate | Result | Evidence |
|---|---|---|
| 1 Root cause addressed in code | **PASS** | Selector + upsert tests |
| 2 Partial-payment duplication tests | **PASS** | Unit |
| 3 Fully paid remain correct | **PASS** | Unit |
| 4 Normal COD remain correct | **PASS** | Unit |
| 5 Current order totals | **PASS** | Unit |
| 6 Payment calculations verified | **PASS** for PARTIAL current−outstanding; **NOT VERIFIED** for adjustments |
| 7 Database schema compatible | **FAIL** | Production columns missing |
| 8 Concurrent sync assessed | **PASS** as assessment; race **NOT VERIFIED** |
| 9 Webhook retries safe | **PASS** | Unit |
| 10 India Post unaffected | **NOT VERIFIED** live; **PASS** lock unit tests |
| 11 Existing AWBs unchanged | **PASS** unit; live **NOT VERIFIED** |
| 12 New invoices correct | **NOT VERIFIED** (no dedicated invoice import test) |
| 13 Historical invoices protected | **PASS** (code + 0 invoices on 249) |
| 14 Multi-tenant isolation | **PASS** code; live **NOT VERIFIED** |
| 15 TypeScript | **PASS** | `npm run typecheck` |
| 16 Relevant automated tests | **PASS** | 136 tests this session |
| 17 Staging integration | **BLOCKED** | Stack down / not run |
| 18 Rollback documented | **PASS** | Section 23 |
| 19 Monitoring plan | **PASS** | Section 24 (not installed) |
| 20 Production config compatibility | **FAIL** | Schema vs insert payload |

---

## 26. Final Go / No-Go Recommendation

# BLOCKED — ADDITIONAL VALIDATION REQUIRED

The fix is the right code change. It must **not** ship to production until:

1. **P0** — Apply (on staging first, then production after approval) `20261029120001_shopify_fulfillment_eligibility.sql`, reload PostgREST, **or** change inserts to omit unknown columns (separate implementation approval).
2. **P0** — Run isolated staging (or Shopify mock + local DB with the three columns) for a deposit/edit PARTIAL order and a paid control.
3. **P1** — Explicitly accept DELETE+INSERT races, or wrap refresh in a transaction.
4. **P1** — Explicitly accept that **234** unbooked historical PARTIAL duplicates will likely rewrite on next sync, and **15** booked orders may show new totals with old extra lines.

### Blockers ranked

**P0 — must fix before deployment**

| Item | Smallest safe solution |
|---|---|
| Production schema missing three columns | Apply the existing additive migration after backup; reload schema cache. Do not unique-index yet. |
| Staging validation not executed | Start isolated `npm run staging:up` / local Supabase `postbuslocal`, never `hgacoeoovjxkzfbesmvl`, then import one edited PARTIAL fixture. |

**P1 — resolve or accept**

| Item | Smallest safe solution |
|---|---|
| Non-atomic line refresh | SQL function transactional replace scoped by `organization_id` + `order_id`. |
| Booked header vs lines | Skip `total_amount`/`subtotal` updates when shipment/order is weight-locked (separate change). |
| Historical self-heal | Tenant notice; exclude booked from sync line/total rewrite until recovery. |

**P2 — follow-up**

Unique line identity after cleanup; booking weight once `unfulfilled_quantity` exists; transaction-sum `amount_paid` if finance requires it.

---

**This session did not:** deploy, migrate production, mutate Shopify, book India Post, repair history, commit, or push.
