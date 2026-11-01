# PostBus Multi-Print hardening report

Date: 2026-10-18  
Scope: `/dashboard/labels/multi-print` and `POST /api/v1/label-template/multi-sheet`  
Deployed to production: **no**  
Migration applied to production: **no**

This is the packing-label sheet compositor. India Post booking, AWB generation, tracking, and official barcode logic were not changed.

---

## SECTION A — ROOT CAUSE

**Issue 1 — VIEWER could print.**  
`permissionForTenantRoute` maps all `POST label-template/multi-sheet` to `labels.read`. The handler then branched on raw `body.disposition === "print"` and called `printMultiUpSheet`, which writes storage and enqueues a Print Agent job. VIEWER has `labels.read` only, so the route-level check was insufficient. Preview and download correctly need read access; print is a mutation and needs `labels.write`.

**Issue 2 — Multi-order PDF attached to the first shipment only.**  
`renderMultiUpSheet` kept a single `shipmentId` from the first unique order. `persistLabelPdf` and `print_jobs.shipment_id` are NOT NULL and one-to-one. There was no junction table. The composed PDF was a sheet-level document stored as if it belonged only to shipment A.

**Issue 3 — Unbounded label loading.**  
`fetchAllLabelRecords` in `MultiPrintScreen` paged `GET /api/v1/labels` at pageSize 100 until `total` was exhausted. The main Labels table was already paginated (pageSize 20). Multi-Print was the outlier.

**CSRF.** Cookie sessions use `SameSite=Lax`, which blocks typical cross-site POST cookies. There was no Origin check on this route. That is mitigation, not a full application-level CSRF gate for cookie POSTs.

**PDF performance.** Unique label PDFs were rendered sequentially (not `Promise.all`). Large sheets could still spend a long time on the request thread.

**Idempotency.** Manual print jobs had no client key. Double-submit could enqueue two jobs.

---

## SECTION B — CHANGES IMPLEMENTED

| File | Change |
|------|--------|
| `lib/api/v1/label-template.ts` | Normalize disposition; Origin check; `labels.write` before print; pass Idempotency-Key |
| `lib/api/v1-permissions.ts` | Unchanged: route stays `labels.read` |
| `lib/security/origin.ts` | `assertBrowserOrigin` |
| `modules/labels/multi-up/request.ts` | Export `MAX_LABELS`, `normalizeMultiUpDisposition` |
| `modules/labels/multi-up/render.ts` | Collect all members; bounded PDF pool (3); persist sheet + junction; audit log; copies remain 1 |
| `modules/labels/multi-up/map-pool.ts` | Bounded concurrency helper |
| `modules/labels/multi-up/idempotency.ts` | 2-minute print key window via `idempotency_keys` |
| `modules/labels/multi-up/selection.ts` | Page size 50, merge/dedupe, 100-label cap, query path |
| `modules/labels/sheet-members.ts` | Insert `label_sheet_members` |
| `modules/labels/custom-label-service.ts` | Resolve returns `{ shipmentId, orderId }` |
| `modules/labels/persist.ts` | Snapshot may include sheet metadata |
| `modules/labels/list.ts` | Optional `q`; **do not send `p_search` unless searching** (compat with unmigrated RPC) |
| `lib/api/v1/commerce.ts` | Pass `q` from GET labels |
| `components/labels/multi-print-screen.tsx` | Infinite query, search, load more, selection cap, write-gated Print, Idempotency-Key |
| `app/dashboard/labels/multi-print/page.tsx` | `notFound()` when flag is off |
| `supabase/migrations/20261018120000_label_sheet_members.sql` | Junction table, RLS, optional search on `label_shipment_groups` |
| `.env.example` | Document `NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED` |
| `vitest.config.ts` | Exclude `.next-verify` copies of tests |

---

## SECTION C — SECURITY FIXES

**Permission.** Route-level permission remains `labels.read`. After normalizing disposition, `disposition=print` requires `hasPermission(role, "labels.write")` **before** render, persist, storage, or enqueue. Invalid/missing disposition becomes `inline` (read). Frontend Print is disabled without `labels.write`; the server is authoritative.

**Tenant isolation.** `loadCustomShippingLabel` / `resolveCustomLabelShipment` still filter `organization_id`. Junction rows include `organization_id` and FKs to org-scoped labels, shipments, and orders. RLS: `is_org_member(organization_id)`.

**CSRF.** Existing `SameSite=Lax` cookies remain. Print requires a matching `Origin`. Mismatched Origin on any multi-sheet POST is rejected. Cross-origin print creates no persist or job (tested).

**Print-job authorization.** Print path: Origin → `labels.write` → packing entitlement (existing `handleV1`) → station/paper decision → persist → junction → enqueue (`copies: 1`).

---

## SECTION D — DATABASE CHANGES

New table `label_sheet_members` (not applied to production):

- FKs: organization, label, shipment, order  
- Unique `(label_id, shipment_id)`  
- Indexes on `(organization_id, shipment_id)` and `(organization_id, label_id)`  
- RLS tenant-all via `is_org_member`

`labels.shipment_id` stays NOT NULL (first member is the technical FK for Print Agent). Membership of the sheet is the junction.

`label_shipment_groups` gains optional `p_search` with a default. Existing 4-argument calls remain valid after the migration. The app omits `p_search` when unused so **unmigrated** environments still list labels.

No destructive changes. Old first-shipment-only label rows are left in place.

Rollback: drop `label_sheet_members` and restore the previous `label_shipment_groups` function. Application can keep listing labels; print persistence of members would fail until the table exists.

---

## SECTION E — PERFORMANCE

**Label loading (before).** Multi-Print looped `GET /api/v1/labels?pageSize=100` until all groups loaded.

**Label loading (after).** First request is `page=1&pageSize=50`. Further pages only on **Load more**. Search uses optional `q` (needs migrated RPC). Selection lives in the print queue, not the current page.

**Measured in browser (local, 2026-10-18):** Multi-Print showed **Showing 27 of 27** chips after a single list request; search field present; chip select filled the print queue. No fabricated load-time benchmarks.

**PDF rendering.** Unique order PDFs render with concurrency 3 instead of a fully serial loop. Composition, rotation, barcodes, and fonts are unchanged. No wall-clock comparison was recorded.

---

## SECTION F — TEST RESULTS

Command: `npx vitest run` on labels/multi-up, permissions, origin, entitlements (116 tests in the full related run).  
`npx tsc --noEmit`: **PASS** (run before the optional-`p_search` omit; re-run after that edit).

| ID | Case | Result |
|----|------|--------|
| 1 | VIEWER preview (inline) | PASS |
| 2 | VIEWER download (attachment) | PASS |
| 3 | VIEWER cannot print | PASS |
| 4 | OWNER/write user can print (existing paper-match print test) | PASS |
| 5 | Unauthorized print: no persist, no job | PASS |
| 6 | Cross-org order IDs rejected | PASS (`print-sheet.test.ts`) |
| 7 | Cross-org shipment IDs rejected | PASS (same org-scoped loader path) |
| 8 | Junction org-scoped | PASS (insert helper + org id on rows) |
| 9 | Two-order sheet references both shipments | PASS |
| 10 | Four-shipment sheet not first-only | PASS (`sheet-members.test.ts`) |
| 11 | Print history associations | PASS at persistence layer (junction + snapshot). Shipment-detail UI still lists jobs by `print_jobs.shipment_id` (first member) until a follow-up UI reads the junction. |
| 12 | Failed persist/enqueue is not success | PASS |
| 13 | Initial page does not fetch all | PASS (`multiPrintLabelsPath` pageSize 50; browser showed one page) |
| 14 | Selection persists across pages | PASS (`mergeSelectedItems`) |
| 15 | Selected IDs unique | PASS |
| 16 | Max 100 composed | PASS (UI merge + API parse) |
| 17 | Over 100 rejected | PASS |
| 18 | Disconnected printer | PASS (`print.test.ts` + API) |
| 19 | Paper mismatch | PASS |
| 20 | Custom paper no print | PASS |
| 21 | Agent copies stay 1 | PASS |
| 22 | Cross-origin print rejected | PASS |
| 23 | Business packing entitlement | PASS (`lockedFeatureForApi` packing) |
| 24 | Flag off 404/API not found | PASS (API + `flag.test.ts`; page uses `notFound()`) |
| 25 | Duplicate Idempotency-Key one job | PASS |
| Regression | Layout/PDF/paper/A3/A6/moved slot | PASS |

Lint: `eslint` on the touched files reports **one pre-existing error** in `multi-print-screen.tsx` (`setPresetQuantity` inside an effect, line ~592) plus existing `<img>` / hook-deps warnings. Not introduced by this patch; not refactored.

Browser (local, signed-in merchant, 2026-10-18): Multi-Print loads, search control present, **Showing 27 of 27**, chip select adds to print queue, Preview/Download enable. Print stayed disabled because printer paper was not ready (existing station gate). VIEWER print was **NOT RUN** in the browser (no viewer session). Print Agent live print **NOT RUN**. Migration **NOT RUN** against hosted DB.

---

## SECTION G — PRODUCTION READINESS

**READY FOR STAGING** (not production).

Remaining risks:

1. `label_sheet_members` must be applied in staging before print can record multi-shipment membership. Preview/download work without it. Print will fail on insert if the table is missing.
2. Server-side search (`q`) needs the migrated `label_shipment_groups(..., p_search)`. Listing without `q` works on the old 4-arg RPC.
3. `print_jobs.shipment_id` remains the first member for Print Agent FK compatibility. Accurate multi-shipment history requires querying `label_sheet_members`.
4. Origin check on print can fail non-browser clients that omit Origin (intended).
5. Idempotency window is 2 minutes and requires the `Idempotency-Key` header (the UI sends it).

---

## SECTION H — DEPLOYMENT CHECKLIST

Do **not** deploy this session.

1. Deploy application to **staging** with `NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED` unset or `true`.
2. Apply `supabase/migrations/20261018120000_label_sheet_members.sql` to **staging only**. Confirm `label_sheet_members` RLS and `label_shipment_groups` 5-arg grant.
3. Staging verification: VIEWER preview/download; VIEWER print 403; staff print with connected matching paper; two-order sheet has two junction rows; Multi-Print first page only; load more; 100-label cap; custom paper download-only.
4. Production: same migration then app release (or reverse if you must keep print working only after table exists — **migration first**, then app, because print insert requires the table).
5. Rollback app: revert release. Rollback DB: drop `label_sheet_members`; restore prior `label_shipment_groups` function. Historical `labels` rows stay.

Feature flag kill switch: `NEXT_PUBLIC_MULTI_UP_PRINT_ENABLED=false` (page 404, API not found). Does not roll back schema.
