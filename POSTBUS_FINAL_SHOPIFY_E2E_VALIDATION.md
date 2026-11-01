# PostBus Final Shopify Application E2E Validation

**Date:** 2026-11-01  
**Production writes:** none  
**Production migrations applied:** none  
**Live Shopify Admin HTTP:** none  
**Live India Post / barcode allocation:** none  
**Commit / push:** none

## Deployment readiness verdict

**READY FOR PRODUCTION APPROVAL**

This means isolated application-level staging passed: Next.js webhook import, PostgREST RPC (service role and authenticated JWT), tenant isolation, stale snapshots, booked AWB/invoice freeze, and financial mapping for the ₹1049 / ₹734.30 / ₹314.70 partial case.

It does **not** mean production may be migrated or deployed yet. Production still needs an explicit approval to apply additive migrations and then ship app+workers together.

---

## 1. Staging environment identity

| Item | Value |
|---|---|
| App | `http://127.0.0.1:3001` (`POSTBUS_ENV=staging`, `POSTBUS_NEXT_DIST_DIR=.next-staging-e2e`) |
| Supabase API | `http://127.0.0.1:54321` (local Docker `project_id=postbuslocal`) |
| Docker Postgres | host port **54332** (`supabase_db_postbuslocal`) |
| CEPT stub | `http://127.0.0.1:4099` `provider_mode=STUB` |
| Production project `hgacoeoovjxkzfbesmvl` | **not used for writes** |
| Port `:3000` `npm run dev` | **not used for these tests** |
| JWT `iss` | `supabase-demo` (local), role `service_role` / `authenticated` |

`.env.staging.local` points at loopback 54321. Custom `SHOPIFY_API_KEY/SECRET` stayed empty (staging runtime refuses them). HMAC used `SHOPIFY_PUBLIC_APP_CLIENT_SECRET` (test-only) on `POST /api/shopify/webhooks`.

## 2. Actual services started

| Service | Result |
|---|---|
| Local Kong / GoTrue / PostgREST | Started (WSL Docker). Auth/REST flapped during recovery; E2E retried until 200 |
| Next staging `:3001` | Started. First Turbopack cache on `.next-staging` **panicked**; restarted on a fresh `.next-staging-e2e` dist |
| CEPT stub `:4099` | Healthy |
| Bootstrap PG `:55432` | **Down** on the concurrency re-run this pass (not required once Docker schema was live) |

## 3. Database schema compatibility

Real local migration chain is present on Docker Postgres (not the slim 55432 bootstrap). This session applied **only locally**:

- `20261101090000_replace_shopify_order_line_items` (`CREATE FUNCTION`, columns already existed from `20261029120001`)
- Grants: `authenticated` + `service_role` EXECUTE
- `NOTIFY pgrst, 'reload schema'`
- Recorded in `supabase_migrations.schema_migrations` **on local Docker only**

`order_line_items.source_line_item_id`, `unfulfilled_quantity`, `requires_shipping` exist locally.

## 4. PostgREST RPC permissions

`replace_shopify_order_line_items` through the **same REST path the app uses** (`POST /rest/v1/rpc/...`):

| Check | Result |
|---|---|
| Function in OpenAPI schema cache | **PASS** |
| `service_role` EXECUTE → `action: replaced` | **PASS** (HTTP 200, no `PGRST204`) |
| Cross-tenant org B on org A order | **PASS** (HTTP 400, order not found) |
| GoTrue signup + `authenticated` JWT EXECUTE | **PASS** |
| Authenticated cross-tenant | **PASS** (HTTP 400) |

Direct superuser `psql` was used only to apply the local migration and seed booked/invoice rows. RPC compatibility is proven via PostgREST.

## 5. Webhook E2E results

Signed mock payloads to **`POST http://127.0.0.1:3001/api/shopify/webhooks`**. HMAC verified by the real route. Invalid HMAC rejected.

Staging log: `shopify_app.webhook.order` with `imported`/`updated` (not skipped) after fulfillable remaining qty was present on the payload.

**37/37 application E2E checks PASS** (`scripts/staging/shopify-app-e2e-last.json`).

Live Shopify store HTTP was **not** executed. GraphQL re-read was not used (installation `encrypted_access_token` null; webhook body is the fallback).

## 6. Partial payment import

Scenario A: edited order, deposit `current_quantity=0`, replacement `current_quantity=1`.

| Field | Expected | Actual (staging DB) |
|---|---|---|
| Active lines | 1 (LineItem 9 only) | **PASS** |
| Current total | ₹1049 | **1049** |
| Outstanding | ₹734.30 | **734.30** (COD collect) |
| Settled | ₹314.70 | **314.70** `amount_paid` |
| Payment status | PARTIAL | **PARTIAL** |

This is Shopify **outstanding-based** mapping from the webhook payload, not a captured-transaction reconciliation (no `transactions[]` settlement evidence on this fixture).

## 7. Fully paid regression

Scenario B: `financial_status=paid`, one active line, `amount_paid` matches current total. **PASS**.

## 8. COD regression

Scenario C: COD gateway, total ₹499, `amount_paid=0`, `cod_amount=499`, status `COD`. **PASS**.

## 9. Duplicate prevention

| Case | Result |
|---|---|
| D: two active lines, same SKU, distinct LineItem IDs 41 and 42 | **PASS** (both GIDs stored) |
| E: repeated delivery, same `x-shopify-webhook-id` | **PASS** (`duplicate: true`, one line) |

## 10. Concurrency results

| Test | Result |
|---|---|
| F: two overlapping webhooks (1-line vs 2-line) | **PASS** — winner was the complete 2-line set (GIDs 62, 63), **not mixed** with 61 |
| Dual-session `psql` on `:55432` this pass | **NOT EXECUTED** (port refused). Previously passed this calendar day on 55432 |
| PGlite `replace-line-items.pg.test.ts` | **PASS** (9 tests) |

## 11. Stale snapshot verification

Processed newer `updated_at` first, then older:

| Case | Result |
|---|---|
| Older snapshot after newer | **PASS** — total stayed ₹2000, line stayed GID 81 |
| Equal timestamps | **PASS** — remained ₹2000 |
| Missing `updated_at` | **PASS** — still imported |
| Concurrent webhook F | **PASS** (atomic winner, see §10) |

## 12. Booked AWB protection

Scenario H: order marked `BOOKED`, shipment barcode **`ET214330016IN`**, weight 800 g, COD 734.30. Then a paid update with a new LineItem GID 199.

AWB, booked status, and weight unchanged. New GID was **not** written. **PASS**.

No production barcode range was used.

## 13. Invoice protection

ISSUED `sales_invoices` snapshot `grand_total_paise=31470` unchanged after the booked-order webhook. **PASS**.

## 14. Multi-tenant security

- PostgREST RPC org B → org A order: denied  
- Authenticated JWT cannot replace another org’s order  
- HMAC for a second public-app secret rejected  

**PASS**

## 15. Automated test results

| Suite | Result |
|---|---|
| line-items, payment, graphql/orders, oauth, webhooks, handle | **60 PASS** |
| `modules/shopify/orders.test.ts` | **66 PASS** |
| `replace-line-items.pg.test.ts` | **9 PASS** |
| `tsc --noEmit -p tsconfig.build.json` | **PASS** |
| ESLint (Shopify webhook/order modules) | **PASS** (exit 0) |
| Full `vitest run` repo suite | **NOT EXECUTED** (prior OOM risk) |
| Dedicated shipment/invoice regression packages | **NOT EXECUTED** this pass (covered by webhook H + invoice freeze) |

## 16. Remaining risks

1. WSL Docker Kong/Auth still **flaps** (unclean shutdown / Auth race). Staging is usable with retries; it is not a production-grade local platform.  
2. First Turbopack cache on `.next-staging` aborted (`Restore of All for task ... failed`). Workaround: fresh dist dir.  
3. Webhook E2E used **mock signed REST payloads**, not a live Shopify shop GraphQL re-read. Production public-app installs **will** re-read GraphQL when a token exists.  
4. Import eligibility still requires remaining qty (`fulfillable_quantity` / `unfulfilled_quantity`) or the webhook is skipped — that is existing product behavior, not a test gap.  
5. Historical production duplicates are **not** auto-repaired (by design).  
6. `:55432` slim cluster is **not** equivalent to the app schema; do not use it as the Next.js database.

## 17. Production migration prerequisites

Do **not** apply until explicit approval:

1. Backup production.  
2. Apply additive `20261029120001` then `20261101090000` (IF NOT EXISTS columns + RPC; **no** unique index on `source_line_item_id`).  
3. Reload PostgREST schema cache.  
4. Confirm `service_role` / `authenticated` EXECUTE on `replace_shopify_order_line_items`.  
5. Deploy **app and workers together** after schema is live (avoid `PGRST204`).  
6. Do not point a webhook test at `www.postbus.in` or production `:3000`.

Production still missing those three line-item columns until migrate (last read-only check this program of work).

## 18. Verdict

**READY FOR PRODUCTION APPROVAL**

Application-level staging (Next + PostgREST + isolated Docker Postgres + CEPT stub) imported Shopify webhooks correctly for partial, paid, COD, duplicates, repeats, concurrency, stale snapshots, booked AWB, and issued invoices.

**STOP.** Wait for explicit approval before production migrate or deploy.
