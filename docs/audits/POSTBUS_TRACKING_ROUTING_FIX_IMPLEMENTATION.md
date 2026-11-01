# POSTBUS — Tracking and Routing Fix Implementation

Date: 18 Oct 2026  
Mode: local source changes, unit tests, TypeScript, production build.  
Production deployment: **not performed**.  
Production SQL: **read-only revalidation only**. No writes, no migrations, no job replay, no live CEPT calls.

## 1. Executive Summary

The tracking pipeline was classifying rejected or empty India Post bulk responses as a completed synchronization. `last_tracked_at` was advanced, the background job could finish `SUCCEEDED`, and no `tracking_events` were stored. The public page then showed **BOOKED** and an empty journey that said India Post had not updated the shipment.

This change keeps the existing bulk-tracking engine and adds structured outcomes so an accepted empty history, an unmatched article, and a rejected HTTP chunk stay distinct. Valid matching events are still ingested. HTTP 403 remains a tracking authorization failure and does not disconnect booking or trigger the Patch 1 login hold. The public page now says when updates are missing, stale, or temporarily unavailable.

These code changes do **not** create scans for AWB `CX075364450IN`. A read-only production check still shows zero events. India Post must confirm Bulk Tracking entitlement for that customer. That is **CEPT CONFIRMATION REQUIRED**.

## 2. Reference AWB Findings

Read-only production query on 18 Oct 2026, project `hgacoeoovjxkzfbesmvl`. No credentials or customer contact fields were selected.

| Field | Value |
| --- | --- |
| AWB | `CX075364450IN` |
| Organization hash | `1611061c64c98c069cb5d84034c624ce` |
| Status | `MANIFEST_READY` |
| Operational status | null |
| Booked at | 2026-10-15 07:42:34 UTC |
| `last_tracked_at` | 2026-10-17 14:51:13 UTC |
| `last_event_at` | null |
| Shipment `tracking_events` | 0 |
| Organization `tracking_events` | 0 |
| Shipments with `last_event_at` | 0 |
| Pollable AWBs | 163 |
| India Post connection | `CONNECTED` |

Tracking-sync jobs for that organization in the last 48 hours:

| Status | `last_error_code` | Jobs |
| --- | --- | --- |
| SUCCEEDED | empty | 1309 |
| FAILED | `HTTP_403` | 113 |
| FAILED | `PROVIDER_ERROR` | 6 |
| SUCCEEDED | `HTTP_502` | 4 |
| SUCCEEDED | `ETIMEDOUT` | 3 |
| QUEUED | empty | 1 |

The earlier audit’s “97 HTTP 403 after 14:51 UTC” window was not repeated as a narrower query. The 48-hour count is **113** `HTTP_403` failures. The shipment row itself is unchanged: still no events.

Official India Post website scans were **not** fetched and were **not** written into PostBus.

## 3. Confirmed Root Causes

1. `IndiaPostProvider.trackShipment` skipped HTTP 400 and 404 chunks and returned `data: []`. Callers treated that like an accepted empty history.
2. `syncTracking` set `last_tracked_at` when no article matched, then the job completed `SUCCEEDED` with no events.
3. `ingestBulkTrackingArticle` did the same when `tracking_details` was empty.
4. A single returned article with a **different** article number was attached to the requested AWB.
5. Public `refreshLiveTracking` swallowed provider errors as `liveTracking: "unavailable"` and the journey copy always said India Post had not updated the shipment.
6. Repeated `HTTP_403` on `/tracking/bulk` is a tracking-call failure while booking stays `CONNECTED`. The CEPT reason text was not stored and was not re-requested.

Events for this AWB were not deleted. They were never inserted.

## 4. Provider Response Handling Changes

`trackShipment` still posts `{ bulk }` to `/tracking/bulk` in chunks of 500 with the existing bearer token.

Each chunk is classified internally as one of:

`SUCCESS_WITH_EVENTS`, `SUCCESS_WITH_EMPTY_HISTORY`, `SUCCESS_WITH_UNMATCHED_ARTICLE`, `SUCCESS_WITH_PARTIAL_RESULTS`, `CHUNK_HTTP_400`, `CHUNK_HTTP_401`, `CHUNK_HTTP_403`, `CHUNK_HTTP_404`, `CHUNK_HTTP_429`, `CHUNK_HTTP_5XX`, `NETWORK_TIMEOUT`, `INVALID_RESPONSE`, `PARSE_FAILURE`, `AUTHENTICATION_FAILURE`.

HTTP 400 and 404 no longer become a silent empty success. They stay on the result as rejected chunks. Earlier successful chunks in the same call are kept. HTTP 401, 403, 429, and 5xx still fail the call when no article data was accepted. If an earlier chunk already returned articles, that data is returned with `hardFailure` instead of being discarded. Thrown tracking errors use `India Post tracking request failed (HTTP <status>).` The raw CEPT body is not copied into the error message or the tracking-sync log line.

An HTTP 200 with `data: []` is `EMPTY_ACCEPTED` / `SUCCESS_WITH_UNMATCHED_ARTICLE`. An HTTP 200 article with an empty `tracking_details` array is `SUCCESS_WITH_EMPTY_HISTORY`. Those are not rejections.

## 5. Article Matching Changes

Matching uses a whitespace-stripped, case-insensitive article number. Response array position is not used. The original number is left on the article for display.

- Exact, lower-case, and internal-space differences match the same article.
- An article that was not requested is ignored.
- A single returned article with a **different** number is not attached. The previous fallback that accepted `UNKNOWN` for the requested AWB was removed.
- A single returned article with **no** article number and at least one scan can still attach when exactly one AWB was requested.
- Two returned rows with the same normalized number are `AMBIGUOUS` and are not ingested.

## 6. Event Ingestion Changes

Events that parse to a real occurrence time are stored, including descriptions the status mapper does not recognize. Events with no trustworthy time are counted as `eventsSkippedUntimed` and are not given a fabricated timestamp. Logs record the skip count, not the event text or the customer payload.

Duplicate inserts still rely on the existing unique conflict (`23505`) and do not delete history. Inserts and shipment updates remain scoped with `organization_id` and `shipment_id`. A missing organization or shipment id throws before insert.

`Item Received at Destination` and `Bag Received for Forwarding` stay in transit. `Item Invoiced to BO` and `Item Booked` do not become `DELIVERED`. Existing older-event downgrade protection was not rewritten.

## 7. Timestamp / Polling Semantics

No column was added.

`last_event_at` is still the occurrence time of the latest ingested scan.

`last_tracked_at` is still the polling due-clock. It is updated when an accepted lookup has no new scan and when a non-retryable rejection (including HTTP 403) is recorded, so the scheduler does not call CEPT again on the next cron tick. It is **not** proof of a successful India Post synchronization. Job progress records `timestampSemantics: "attempt_clock"`. The public page does not display `last_tracked_at`. Public “Last Updated” continues to use `last_event_at`.

Retryable HTTP 429, HTTP 5xx, and timeouts do **not** move the attempt clock, so the same job can retry under the existing attempt backoff.

A future column `last_tracking_attempt_at`, if approved separately, would let `last_tracked_at` mean only an accepted provider lookup. That migration was not written and was not applied. Rollback would be dropping the unused column. Polling queries and indexes would need a reviewed change at that time.

## 8. Rejected Chunk Handling

If every chunk is rejected, `providerSyncOutcome` is `REJECTED`. The job progress says so. For HTTP 400/404 the worker does **not** throw, because marking the job `FAILED` would let the scheduler enqueue another tracking-sync immediately and recreate a request storm. The terminal job status can still be `SUCCEEDED` while progress says `REJECTED`. That limitation is intentional and is visible in `background_jobs.progress`.

HTTP 403 still throws after the attempt clock is stamped. The job becomes `FAILED` with `HTTP_403` under the existing non-retryable 4xx policy. The next cron may enqueue a job, but shipments are not due again until the existing unscanned cutoff (2 minutes) or the normal interval (15 minutes). Login holds are not applied.

HTTP 429 and 5xx stay retryable through the existing job attempt delays (`60s`, `5m`, `15m`, `30m`, max 5 attempts). They do not get a new immediate enqueue loop inside this change.

## 9. Background Job Progress

`syncTracking` writes progress on the organization job:

`awbsEligible`, `awbsAttempted`, `awbsMatched`, `awbsWithEvents`, `awbsWithoutEvents`, `awbsUnmatched`, `awbsAmbiguous`, `awbsRejected`, `eventsInserted`, `eventsDuplicate`, `eventsSkippedUntimed`, `batchesAttempted`, `batchesSucceeded`, `batchesFailed`, `noWork`, `providerSyncOutcome`, `timestampSemantics`.

`providerSyncOutcome` is `NO_WORK`, `SUCCEEDED`, `EMPTY_ACCEPTED`, `PARTIAL`, or `REJECTED`. AWB lists and customer payloads are not written into progress or the sync log.

## 10. HTTP 403 Authorization Handling

HTTP 403 from bulk tracking keeps status `403` and code `HTTP_403`. It is not tagged as a login operation, so Patch 1 login cooldowns do not start from a bulk 403 alone. Booking credentials are not cleared. The connection is not set to disconnected. Shipments are not marked delivered or failed. The public page does not show the CEPT body.

Recovery is the existing path: when India Post starts returning HTTP 200, the next due tracking pass ingests articles. No new entitlement flag was stored.

**CEPT CONFIRMATION REQUIRED.** This release does not prove why this customer receives HTTP 403 on `/tracking/bulk` while booking stays connected.

## 11. Public Tracking API Changes

`PublicTrackResult.trackingAvailability` may be:

`TRACKING_AVAILABLE`, `TRACKING_NO_SCANS_YET`, `TRACKING_SYNC_PENDING`, `TRACKING_TEMPORARILY_UNAVAILABLE`, `TRACKING_PROVIDER_UNAUTHORIZED`, `TRACKING_DATA_STALE`.

Existing `liveTracking` values (`ok`, `cached`, `unavailable`, `not_connected`) remain. Live refresh failure keeps stored events. It does not replace them with an empty array. HTTP 401/403 with no stored events is `TRACKING_PROVIDER_UNAUTHORIZED`. The same failure with stored events is `TRACKING_DATA_STALE`. Rejected chunks are not described as “no scans yet”.

Successful and failed live lookups are cached for the existing 60 seconds so a public refresh does not become a CEPT poll loop. The route rate limit is unchanged at 20 requests per minute.

## 12. Public Tracking UI Changes

The journey no longer says scans will appear once India Post updates the shipment.

| State | Customer copy |
| --- | --- |
| No scans yet | Tracking updates are not available yet. Please check again later. |
| Refresh failed | We couldn't refresh the latest India Post tracking updates right now. Please try again shortly. |
| Stored events, refresh failed | Showing the latest tracking updates available in PostBus. New updates are temporarily unavailable. |
| Tracking authorization failure, no stored events | Live tracking updates are temporarily unavailable. Please try again later or contact support. |
| Events available | Journey, latest event first, grouped by India date, time in `Asia/Kolkata` |

The progress indicator uses stored scan stages. A dispatch or destination-office scan can show in transit. Destination receipt and “invoiced to BO” do not show delivered. A `MANIFEST_READY` shipment with no transit scan stays Booked.

## 13. Shipment Status Mapping

No mapper rewrite. Verified current phrases:

| Phrase | Result |
| --- | --- |
| Item Booked | stored, no terminal status |
| Item Bagged / Item Dispatched | dispatched movement, shipment `IN_TRANSIT` when the existing rank allows it |
| Bag Received / Bag Received for Forwarding | `IN_TRANSIT` |
| Item Received at Destination | `IN_TRANSIT`, not `DELIVERED` |
| Item Invoiced to BO | stored, classification null, not `DELIVERED` |
| Out for delivery / Delivered | unchanged existing rules |
| Unknown text with a valid time | history stored, no invented terminal status |

Older events still cannot downgrade `DELIVERED`.

## 14. Booking Date Display

`shipments.booked_at` is labeled **Booked in PostBus**. It is not overwritten from a screenshot. If a stored event description matches Item Booked, the page also shows **India Post Booked On** from that event’s timestamp in India time. If that scan is absent, no India Post booked date is invented.

For the reference AWB those are different events: PostBus `booked_at` is 15 Oct 2026 UTC, and the India Post Item Booked scan was not stored.

## 15. Multi-Tenant Security

Event insert and shipment update still filter `organization_id`. The worker only loads shipments for the job’s organization and only ingests an article matched to that shipment’s barcode. Another organization’s article number in the same response is unmatched and is not inserted. Public responses do not add credentials, tokens, raw CEPT bodies, or billing fields. Service-role queries in the worker pass the organization id explicitly. That is not a substitute for RLS, and RLS was not modified.

## 16. Patch 1 Compatibility

Login-origin tagging, login HTTP 400 phrase detection, login HTTP 401, the 15m / 1h / 4h / 12h / 24h hold, no-work probe throttling, and duplicate queued-job cancellation were not retuned. Bulk HTTP 403 does not satisfy `isConfirmedIndiaPostLoginAuthFailure`. A login 401 still does not stamp the tracking attempt clock, so the hold remains what blocks the next enqueue.

## 17. Booking Compatibility

Booking payload, barcode allocation, label, and manifest code were not edited. `trackShipment` still returns `data` and, for an all-400/404 lookup, the provider message used by booking recovery’s “not booked” check. A rejected tracking call still does not throw for HTTP 400, so booking recovery is not failed closed by that status.

## 18. Shopify Compatibility

Shopify fulfillment, tracking URL generation, and order sync were not edited.

## 19. Files Modified

| File | Function | Original | New | Reason | Production impact |
| --- | --- | --- | --- | --- | --- |
| `modules/india-post/tracking-outcomes.ts` | new helpers | none | chunk outcomes, job progress, page plan | one place for success vs rejection | none until the worker calls it |
| `modules/india-post/provider.ts` | `trackShipment` | 400/404 skipped into empty `data`; other HTTP errors threw and dropped prior chunks | structured `tracking` metadata; partial success kept; sanitized HTTP errors | stop false empty success | tracking calls return more metadata; booking still reads `data` |
| `modules/india-post/tracking-response.ts` | `classifyRequestedArticles` | case-insensitive match plus single-article fallback even when the number differed | normalized match; reject different numbers and duplicate numbers | stop cross-article attachment | a mislabeled single-article body is no longer ingested |
| `modules/india-post/apply-tracking.ts` | `matchingBulkTrackingArticle`, `ingestBulkTrackingArticle`, `applyIndiaPostTracking` | different-number fallback; empty history only stamped `last_tracked_at`; untimed events logged with text | same match rules; stamp only when nothing was persisted; skip counts; require org and shipment ids | truthful ingest counts | empty lookups still move the due-clock |
| `workers/processor.ts` | `syncTracking` | miss stamped `last_tracked_at` and the job looked fully successful | progress counts; 403 stamps then fails; 400/404 recorded as rejected without a new fail-loop | observable sync | next 403 is bounded by the existing due filter |
| `modules/india-post/tracking-sync.ts` | `trackingSyncDueFilter` | due filter only | comment that `last_tracked_at` is an attempt clock | document the limitation | no query change. The rest of this file’s diff versus git HEAD is pre-existing Patch 1 work already in the working tree |
| `modules/ndr-rto/service.ts` | `syncNdrShipment`, `syncNdrVisibleShipments` | ignored a partial hard failure after applying matches | applies saved matches, then returns a sanitized provider error if a later chunk failed | manual NDR stays honest | a partial 403 can surface after saved scans |
| `modules/tracking-pages/public.ts` | `refreshLiveTracking` | errors became a generic unavailable flag | availability code, stored events kept, 60s negative cache | public copy can tell failure from no scans | public lookup still writes when ingest succeeds |
| `modules/tracking-pages/customer-track-view.ts` | `toCustomerTrackView` | any event on `MANIFEST_READY` became in transit; booked date was one label | stage rank; separate booked labels; journey notice | status matches scans | customers see different labels |
| `components/tracking-page/shipment-journey.tsx` | `ShipmentJourney` | one empty sentence | notice plus India-time groups, latest first | readable history | display only |
| `components/tracking-page/customer-track-experience.tsx` | journey render | events only | passes `journeyNotice` | show the notice | display only |
| `types/api.ts` | `PublicTrackResult` | no availability field | optional `trackingAvailability` | API compatibility | old clients can ignore it |
| Tests listed in section 21 | coverage | old fallback expected a mismatched article | expectations follow the new match rules | lock the correction | tests only |

## 20. Database Migration Requirements

None. No migration file was added. No `supabase db push`. No RLS change. No unique-index change.

## 21. Actual Automated Test Results

Command:

`npx vitest run modules/india-post/tracking-routing-fix.test.ts modules/india-post/tracking-response.test.ts modules/india-post/provider.session.test.ts modules/india-post/apply-tracking.test.ts modules/india-post/event-mapper.test.ts modules/india-post/tracking-sync.test.ts modules/india-post/login-auth.test.ts modules/india-post/tracking-auth-hold.test.ts modules/tracking-pages/customer-track-view.test.ts modules/tracking-pages/public.test.ts`

Result before a later type-only cast: **10 files, 115 tests, passed.**

After the cast in `classifyRequestedArticles`:

`npx vitest run modules/india-post/tracking-routing-fix.test.ts modules/india-post/tracking-response.test.ts modules/india-post/provider.session.test.ts`

Result: **3 files, 32 tests, passed.**

Covered by those runs: HTTP 200 with events, HTTP 200 empty data, empty `tracking_details` classification, HTTP 400, HTTP 404, sanitized HTTP 403 that is not a login failure, HTTP 429/5xx attempt-clock skip, partial chunk retention, article match by number, out-of-order articles, unrequested article, duplicates, unlabeled single-article fallback, missing timestamps, destination receipt not delivered, invoiced-to-BO not delivered, public booked vs India Post booked labels, unauthorized and stale copy, Patch 1 hold enqueue tests.

Not executed as new automated tests: a browser session of `/track`, a PGlite cross-tenant insert, a full background-job processor integration, and a second public HTTP call proving the 60s cache. Those behaviors are implemented and, where noted, covered by existing Patch 1 and apply-tracking tests. No live CEPT call was made.

## 22. TypeScript / ESLint Results

`npx tsc --noEmit --pretty false` exited **0**.

`npx eslint` on the changed files reported one error in `components/tracking-page/customer-track-experience.tsx` at the existing deep-link effect (`react-hooks/set-state-in-effect`). This task only passed `journeyNotice` into `ShipmentJourney`. The effect was not modified. The other changed files reported no eslint errors.

`npx next build` ran its own TypeScript pass and finished successfully. That build log did not show a separate ESLint step.

## 23. Production Build Results

`npx next build` (Next.js 16.3.8, Turbopack) exited **0**. Compile about 3.5 minutes, TypeScript about 29 seconds, 96 static pages generated. This was a local build only.

## 24. Known Limitations

- `last_tracked_at` still moves on rejected non-retryable attempts. Progress says `attempt_clock`. A separate attempt column needs its own migration approval.
- An all-400/404 tracking job can still end `SUCCEEDED` so the scheduler does not storm. Progress `providerSyncOutcome: "REJECTED"` is the truthful record.
- After a tracking job is terminally `FAILED` for HTTP 429 or 5xx, the existing cron can enqueue another job later. This change does not add a second hold for those statuses.
- HTTP 403 is bounded by the current due filter (about 2 minutes for unscanned AWBs), not by the Patch 1 login ladder.
- The reference AWB still has no stored scans. Code cannot invent them.
- A mislabeled single-article CEPT body that used to be ingested will now be unmatched.

## 25. CEPT Provider Confirmation Questions

Do not send these automatically. Do not include credentials.

1. Is Bulk Tracking enabled for this contractual customer ID?
2. Does booking access automatically grant Bulk Tracking access?
3. What causes HTTP 403 on `POST /beextcustomer/v1/tracking/bulk`?
4. Can this customer track articles booked under the same contractual account?
5. Can one unauthorized AWB reject an entire batch?
6. What does HTTP 400 mean for bulk tracking?
7. What does HTTP 404 mean for bulk tracking?
8. Does HTTP 200 with an empty `data` array mean no events, or an unknown article?
9. Are any additional production permissions required for tracking?
10. Are there separate customer-id or article-ownership restrictions?

## 26. Rollback Plan

Revert the files in section 19. There is no schema change to roll back. In-flight jobs keep the old status enum. Progress JSON from the new worker is ignored by older code. Already inserted tracking events, if any are created after deploy, should be kept.

## 27. Production Deployment Risks

- Unscanned AWBs that receive HTTP 403 will be retried after the 2-minute unscanned cutoff instead of on every cron tick. That is less traffic than an unstamped failure loop, and more regular than a login hold.
- Public tracking still ingests on a successful live lookup. Failed lookups are cached for 60 seconds.
- The working tree contains unrelated affiliate, billing, and other edits. Deploying the dirty tree would ship those too.

## 28. Release Candidate SHA

**Not prepared.**

The live production git SHA was not re-verified in this session. The previous audit recorded `d2beb8b420c70a9a68c22b60026b4128803e4a68` and that value was not treated as still live. No release worktree was created, nothing was pushed, and nothing was deployed.

## 29. Final Implementation Verdict

**A. IMPLEMENTATION COMPLETE — READY FOR PRODUCTION RELEASE REVIEW**

The targeted correctness fixes are implemented and covered by the tests above. They are not deployed. They do not by themselves fill routing history for `CX075364450IN`. That still requires an authorized Bulk Tracking response from India Post.

## 30. Recommended Next Action

Review this diff in an isolated worktree cut from the verified production SHA. Exclude unrelated working-tree changes. Ask India Post the section 25 questions for the affected customer id. Deploy only after that review and an explicit production approval.

## Call graph inspected

`enqueueDueTrackingSyncJobs` → `syncTracking` in `workers/processor.ts` → `ensurePersistedIndiaPostSession` → `IndiaPostProvider.trackShipment` → `parseBulkTrackingResponse` / `classifyRequestedArticles` → `ingestBulkTrackingArticle` → `applyIndiaPostTracking` → `tracking_events` and shipment status via `event-mapper.ts`.

Public: `POST /api/v1/public/track` → `publicApexTrackLookup` / `publicTrackLookup` → `refreshLiveTracking` → the same provider and ingest path → `toCustomerTrackView` → `ShipmentJourney`.

Patch 1 login holds remain in `login-auth.ts` and `tracking-auth-hold.ts`, consulted before enqueue.
