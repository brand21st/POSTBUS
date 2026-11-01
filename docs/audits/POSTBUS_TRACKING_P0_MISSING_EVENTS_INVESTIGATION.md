# POSTBUS — P0 Missing Tracking Events Investigation

Date: 18 Oct 2026  
Mode: code inspection and the same-day read-only production SQL check.  
Live India Post calls: none. Production writes: none. Credentials: not read.

## Root cause

**Not confirmed as an application ingestion bug.** The stored evidence points to the India Post bulk tracking response, not to a mapper that deleted events.

AWB `CX075364450IN` still has:

- `shipments.status` = `MANIFEST_READY`
- `last_event_at` = null
- `tracking_events` = 0 for the shipment and for the whole organization
- `last_tracked_at` = 2026-10-17 14:51:13 UTC
- India Post connection `CONNECTED`
- 163 pollable AWBs
- In the 48 hours before that read: 1309 tracking-sync jobs `SUCCEEDED` with an empty error code, and 113 jobs `FAILED` with `HTTP_403`

Zero rows means events were never inserted. The unique index and the status mapper did not run for this article.

## What the code does

| Step | File | Behavior | Evidence |
| --- | --- | --- | --- |
| Token | `modules/india-post/session.ts`, `provider.ts` `token()` | Login or refresh before the tracking call. A login 401 is tagged `indiaPostOperation: "login"` | Login failure is a different error from bulk HTTP 403 |
| Customer and contract | `india_post_connections` selected by `organization_id` | Tracking uses that tenant’s bearer token. The bulk body is only `{ bulk: [barcodes] }` | Customer id is not a field of the tracking POST |
| Request | `IndiaPostProvider.trackShipment` | `POST /tracking/bulk`, max 500, one organization per job | CONFIRMED |
| HTTP 403 | `trackShipment` | Thrown as `HTTP_403` with a sanitized message. Not treated as an expired login. Booking connection is not cleared | CONFIRMED |
| Empty or unmatched 200 | tracking outcome `EMPTY_ACCEPTED` | No fake events. Before the recent outcome work, this still advanced `last_tracked_at` and the job could finish `SUCCEEDED` | CONFIRMED historical behavior. Matches this AWB: stamp set, events 0, then later 403s |
| Ingest | `ingestBulkTrackingArticle` | Inserts only a matched article with a parseable time | No row exists to have failed a constraint |
| Job success | `workers/processor.ts` | A thrown 403 fails the job. An accepted empty page can still finish `SUCCEEDED` while progress says `EMPTY_ACCEPTED` or `REJECTED` | The 1309 successes are compatible with empty provider data, not with hidden scans |

HTTP 403 on `/tracking/bulk` is not evidence that the access token expired. Login failures are tagged separately. Booking remained `CONNECTED`.

## Not verified

- The actual JSON body India Post returned at 14:51 UTC. It was not logged, and this investigation did not call CEPT.
- Whether this contractual customer id is entitled to Bulk Tracking.
- Whether the token at that moment was accepted for booking and rejected only for tracking.
- Whether one AWB in a 500-article batch caused the later 403, or the whole customer was rejected.

## Recommended remediation

1. Ask India Post whether Bulk Tracking is enabled for this customer id, and what HTTP 403 means on `POST /beextcustomer/v1/tracking/bulk`.
2. After entitlement is confirmed, run one authorized tracking sync for this organization and read job progress counts (`awbsMatched`, `awbsRejected`, `eventsInserted`). Do not fabricate scans from the public India Post website.
3. Do not rotate or replace the merchant password as a first step.

## Verdict

P0 is **not fixed**. Event-mapping tests do not prove this AWB can be tracked. The missing data remains **CEPT CONFIRMATION REQUIRED**.
