# POSTBUS NDR/RTO IMPLEMENTATION REPORT

**Date:** 2026-10-10  
**Branch:** `india-post-true-bulk-candidate`  
**HEAD (uncommitted work):** `531c08834a86bf0d5dd0924020840cae48542e71`  
**Audit SHA (historical only):** `67891d40`  
**Production Supabase:** `hgacoeoovjxkzfbesmvl` — **not written, not migrated, not queried**

`POSTBUS_NDR_RTO_PRODUCTION_AUDIT.md` was **not present** in the repository. Findings used current code, tests, `POSTBUS_INDIA_POST_TRACKING_AUDIT.md`, `modules/india-post/spec.ts`, and the CEPT sample fields in the approach document.

## A. Current architecture

CEPT bulk tracking (`IndiaPostProvider.trackShipment`) and quarantined webhooks both call `applyIndiaPostTracking` → `mapIndiaPostEventToShipmentUpdate` / `planTrackingUpdate` → `tracking_events.classification` + `shipments.operational_status` → `GET /api/v1/ndr-rto`. Optional WhatsApp/Shopify run only through `enqueueTrackingStageSideEffects`.

## B. Confirmed root causes

1. **NDR-001:** `classifyEvent` matched bare `"addressee"` before DELIVERED, so `Item Delivered(Addressee)` became NDR.
2. **NDR-002:** `operational_status` is written only when a scan classifies. Unclassified logistics/hold events and historical rows from before projection remain null. There was no replay path.
3. **Shopify:** OFD after NDR queued WhatsApp `in_transit`, which previously also triggered Shopify `in_transit`.
4. **Timestamps:** missing bulk event times used `new Date()`, inventing order.

## C. Files modified (this implementation)

- `modules/india-post/event-mapper.ts`
- `modules/india-post/apply-tracking.ts`
- `modules/india-post/tracking-effects.ts`
- `modules/india-post/webhook.ts` (pass through raw `rts` if present; do not invent a CEPT field)
- `modules/ndr-rto/service.ts`
- `modules/ndr-rto/reconcile.ts` (new)
- `app/dashboard/ndr-rto/page.tsx`
- `types/api.ts`
- Tests listed in the test report
- This report set

## D. Changes implemented

- Evidence-based mapper: remove bare `addressee` NDR; `item_delivered` before generic NDR phrases; official `non_delivery_reason` still NDR; hold/intimation/redirect unclassified; bagged/dispatch/bag received as movement; `rts === true` → RTO not RTO_DELIVERED; return lane remaps later delivery to `RTO_DELIVERED`.
- `projectShipmentFromEvents` for side-effect-free projection.
- Missing bulk timestamps skip status (log `india_post.tracking.missing_event_time`).
- Shopify `in_transit` only when `orderStatus === "IN_TRANSIT"`.
- Dry-run reconciler; `applyReconcileWrites()` throws; production host hard-block.
- Dashboard **Unclassified tracked** count from stored null `operational_status` (not UI-invented NDR/DELIVERED).

## E–F. Tests

See `POSTBUS_NDR_RTO_TEST_REPORT.md`. Slice: **105 passed / 0 failed**.

## G. Remaining risks

- Historical production rows stay unclassified until an **approved** reconcile apply.
- CEPT has no official event catalogue in-repo; mapping is evidence-based heuristics.
- Webhook remains quarantined (empty CIDR). Not enabled.
- Hosted staging sharing a non-production DB is **not available**.
- Working tree contains unrelated dirty files not part of this change.

## H. Unverified CEPT behavior

Official meaning of `Item Redirected`, hold/intimation combinations, and undocumented webhook `rts` is **unverified**. Missing `rts` is not treated as false.

## I. Database migrations

**None.** Existing `20260927140000_ndr_rto.sql` is sufficient. **Not applied to production.**

## J. Historical reconciliation

See `POSTBUS_NDR_RTO_RECONCILIATION_PLAN.md`. Dry-run only. **Do not run on production.**

## K. Staging readiness

**NOT READY (hosted).** Local isolated tests passed. Local Postgres staging (`infra/STAGING.md`) exists but was not deployed to.

## L. Production readiness

**NOT READY / BLOCKED** until explicit deploy approval and hosted non-prod evidence.

## M. Required approvals

1. Code review / merge of this local work.  
2. Staging or production deploy (separate).  
3. Production dry-run reconcile (separate).  
4. Production apply batches (separate).

## N. Git diff summary

Mapper, apply-tracking, tracking-effects, webhook rts passthrough, NDR summary unclassified count, reconcile module, tests, reports. No production env, credentials, or PII added.

## O. Rollback

Application rollback is sufficient (no schema change). Old mapper would restore the Addressee→NDR bug. Projection columns remain nullable.

## P. GO / NO-GO

**NO-GO for production.**  
**READY FOR STAGING (local verification only).**
