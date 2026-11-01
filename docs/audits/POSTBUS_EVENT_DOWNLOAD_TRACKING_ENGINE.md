# PostBus Event Download Tracking Engine

Date: 2026-10-21. Status categories: PASS / FAIL / BLOCKED / NOT TESTED.

## SECTION A — Existing System Audit

PostBus is a Next.js SaaS. Production tracking used `JOB_RUNNER=database`, cron `POST /api/cron/jobs`, and `tracking-sync` in `workers/processor.ts`. All live tracking callers used `IndiaPostProvider.trackShipment` → `POST /v1/tracking/bulk`. Public track, NDR refresh, and booking recovery used the same path. Ingest, `tracking_events` RLS, Shopify side effects (`tracking-effects.ts`), and dashboard Routing Steps already existed. WooCommerce tracking write-back does not exist.

## SECTION B — Root Cause of Tracking Failure

PASS (observed 2026-10-21): booking with the same Bearer token works. `POST /v1/tracking/bulk` returns HTTP 403 “You are not authorized to access this API” for many connected orgs. `tracking_events` had no inserts after 2026-09-26. Jobs succeeding without scans stamped `last_tracked_at` and hid the gap.

## SECTION C — Verified India Post API Capabilities

PASS (document + code): Event Download is `POST {session}/v1/event/download` with `{ Cust_Id, Event_Code: "LE"|"IB", Event_Date: DDMMYYYY }` and XML `LatestEventDetails/ArticleDetails`. LE is latest-event per customer/date, not full AWB history.

BLOCKED: live production Event Download authorization is not proven in this change. A 403 on Event Download must stop rollout.

## SECTION D — Unified Tracking Architecture

Automatic `tracking-sync`, public `/api/v1/public/track`, dashboard refresh, and NDR sync share Event Download → XML parse → org-scoped AWB match → `ingestBulkTrackingArticle`. They do not call `/tracking/bulk`.

## SECTION E — Implementation Changes

- Removed bulk tracking from provider execution.
- Added Event Download client, XML size/DTD guards, in-process customer/date lock.
- Org/date sync engine with checkpoints and 403 cooldown via existing auth-hold (HTTP_403 job rows).
- Pilot allowlist `INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST` (empty in production = off; local/test default all).
- Dashboard freshness copy: last carrier event vs last sync; honest refresh toasts.

## SECTION F — Files Modified

Provider, event-download modules, `workers/processor.ts`, `tracking-sync.ts`, `login-auth.ts`, public track, NDR ingest source, dashboard tracking/shipment pages, env example, migration `20261021140000_tracking_sync_checkpoints.sql`, tests, smoke script, this report.

## SECTION G — Database Changes

New `tracking_sync_checkpoints` (org + cust_id + LE + event_date), RLS `is_org_member`. Additive. No change to `tracking_events` shape. Source meta may be `event_download`.

## SECTION H — Automatic Tracking Flow

Cron enqueue (allowlisted orgs) → `syncTracking` → overlap Event Download (today IST + 1 day) → match org shipments → ingest → optional daily lookback if checkpoints are stale.

## SECTION I — Manual Tracking Flow

Shipment and Tracking pages show stored events first. Refresh calls existing `POST /api/v1/ndr-rto/:id/sync`, which now uses Event Download via `trackShipment`. Cooldown/shared lock prevents request storms. Copy does not claim live per-AWB tracking.

## SECTION J — API Error Handling

200 XML processed (empty XML = no events, not 403). 400/404 recorded per date. 401 retried once via existing session retry. 403 throws HTTP_403, checkpoints UNAUTHORIZED, tracking-sync auth-hold applies. 429/5xx temporary. Malformed/DTD XML quarantined as parse failure.

## SECTION K — Tenant Security Verification

PASS (code): matching is `.eq(organization_id)` plus barcode. Public live refresh uses the shipment’s org connection only. Allowlist gates CEPT. Credentials are not logged.

NOT TESTED: live cross-tenant probe on production.

## SECTION L — Performance Improvements

One Event Download per customer/date instead of 500-AWB bulk pages. Overlap is 2 days, not 7, on every poll. Checkpoints skip recent successes. Shared in-process lock for concurrent refreshes.

## SECTION M — Test Results

PASS (local): 75 related unit tests (Event Download, provider session, routing, NDR, CEPT stub, tracking-sync) plus 21 auth-hold tests.

Live Event Download: BLOCKED / NOT TESTED until a single authorized org smoke (`INDIA_POST_SMOKE=1`) returns HTTP 200 XML.

## SECTION N — Production Deployment Readiness

BLOCKED for global tracking. Safe to deploy code with empty production allowlist (Event Download off; booking unchanged). Pilot: set allowlist to one org after a successful Event Download 200 XML.

Rollback: empty allowlist or `auto_tracking_sync=false`. No destructive migration.

## SECTION O — Known Limitations and Unverified Assumptions

- LE accumulates observed latest events; it is not complete carrier history.
- Event Download XML on production may differ from the May 2026 document.
- WooCommerce tracking sync remains unimplemented.
- GET `/tracking/{article}` is unused as a primary API.

## SECTION P — Required India Post Entitlements

CEPT must entitle `POST /v1/event/download` (and/or restore `/v1/tracking/bulk` later). Evidence for CEPT: same token books; bulk 403; Event Download status from a single controlled smoke.

## SECTION Q — Rollback Plan

1. Set `INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST` empty on Coolify.
2. Optionally disable `automation_settings.auto_tracking_sync`.
3. Do not revert booking env.
4. Checkpoints table can remain; it is unused when allowlist is empty.
