# POSTBUS — India Post Event-Flow Audit

Date: 18 Oct 2026  
Mode: read-only source inspection plus the earlier read-only production check of AWB `CX075364450IN`.  
No code changes, migrations, live CEPT calls, or Shopify writes in this audit.

## 1. Current tracking architecture

Tracking is a combination of scheduled bulk polling, public and merchant live refresh, manual NDR refresh, and an optional webhook inbox. There is no Event Download API client.

```
Cron POST /api/cron/jobs
  -> enqueueDueTrackingSyncJobs (modules/india-post/tracking-sync.ts)
  -> background job tracking-sync
  -> workers/processor.ts syncTracking
  -> IndiaPostProvider.trackShipment
  -> POST {session}/tracking/bulk  body { bulk: string[] }  max 500
  -> parseBulkTrackingResponse / classifyRequestedArticles
  -> ingestBulkTrackingArticle
  -> applyIndiaPostTracking
  -> tracking_events insert + shipments status projection
  -> tracking-effects (WhatsApp / Vachat / Shopify stage / in-app notice)

Public POST /api/v1/public/track
  -> modules/tracking-pages/public.ts refreshLiveTracking
  -> same provider + ingest path
  -> customer-track-view + ShipmentJourney

Webhook
  -> modules/india-post/webhook.ts
  -> IP allowlist, inbox row, processIndiaPostInboxEvent
  -> same applyIndiaPostTracking path

Manual NDR
  -> modules/ndr-rto/service.ts syncNdrShipment
```

| Question | Result | Evidence |
| --- | --- | --- |
| Bulk Tracking API | CONFIRMED | `IndiaPostProvider.trackShipment`, limit `INDIA_POST_TRACKING_BULK_LIMIT = 500` |
| Event Download API | MISSING | No client. Prior spec note says the XML download contract is not supported |
| Webhook | PARTIALLY IMPLEMENTED | Inbox, allowlist, and idempotency exist. Production delivery from India Post is UNVERIFIED |
| Scheduled polling | CONFIRMED | `app/api/cron/jobs/route.ts` calls `enqueueDueTrackingSyncJobs` |
| Manual refresh | CONFIRMED | Public live refresh and NDR sync |
| Source of truth for current status | CONFIRMED | `shipments.status` and `shipments.operational_status`, projected from ingested events |
| History | CONFIRMED | `tracking_events` rows are kept. Refresh does not delete them |
| Latest-only storage | Not the design | Current status columns are a projection. History is the event table |

Reference AWB `CX075364450IN` still has zero `tracking_events`. That is missing provider data, not the UI hiding rows. See `docs/audits/POSTBUS_TRACKING_ROUTING_FIX_IMPLEMENTATION.md`.

## 2. Existing status mapping

`modules/india-post/event-mapper.ts` `classifyEvent` matches phrases on a lowercased key. It does not store the 15 internal categories from the article-flow sheet. Shipment columns use the existing operational enum: `BOOKED`, `DISPATCHED`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `NDR`, `RTO`, `RTO_IN_TRANSIT`, `RTO_DELIVERED`.

Unmapped events are still inserted when they have a parseable time. Their classification is null, so they do not change shipment status. `planTrackingUpdate` refuses to let an older event replace a newer status, and it refuses to move `DELIVERED` backward unless the new event is a return state.

| Official event | Stored if timed | Current classification | Customer label today | Verdict |
| --- | --- | --- | --- | --- |
| Pickup Request Raised | Yes | null | Original text | MISSING category |
| Pickup Assigned | Yes | null | Original text | MISSING category |
| Item Pickup Cancelled | Yes | null | Original text | MISSING category. Does not cancel the order |
| Item Pickedup | Yes | null | Original text | MISSING category |
| Item inducted | Yes | null | Original text | MISSING category |
| Item Booked | Yes | null | Booked only when no stronger scan exists | PARTIALLY IMPLEMENTED |
| Item bagged | Yes | `DISPATCHED` → shipment `IN_TRANSIT` | Dispatched, not “Processing” | PARTIALLY IMPLEMENTED |
| Item Dispatched | Yes | `DISPATCHED` → `IN_TRANSIT` | Dispatched / In Transit | CONFIRMED movement |
| Bag Received | Yes | `IN_TRANSIT` | In Transit | CONFIRMED |
| Item Received | Yes | `IN_TRANSIT` | In Transit | CONFIRMED |
| Item received at Destination | Yes | `IN_TRANSIT` | In Transit, not “Reached Destination” | PARTIALLY IMPLEMENTED. Not treated as delivered |
| Taken out for delivery | Yes | `OUT_FOR_DELIVERY` | Out for Delivery | CONFIRMED |
| Item Kept on Hold | Yes | null | Original text, not On Hold | MISSING category |
| Item Delivered(Addressee) | Yes | `DELIVERED` | Delivered | CONFIRMED |
| Item Redirected | Yes | null | Original text | MISSING category. Not treated as RTO or delivery |

`rts: true` is classified as `RTO`, which is not the same as Item Redirected. A redirect phrase is RTO only when it is `redirected_to_sender`.

## 3. Database structure

`tracking_events` (`supabase/migrations/20260919090100_commerce_shipping.sql`):

`organization_id`, `shipment_id`, `event_code`, `event_description`, `office_name`, `office_id`, `occurred_at`, `raw`, `created_at`, plus later `classification`.

Unique index `tracking_events_dedupe_uidx`: `(organization_id, shipment_id, event_code, occurred_at)`.

Office id, office name, and remarks are not part of the identity. Two legitimate “Item Received” scans at different offices collapse into one row if they share the same timestamp. Repeated scans at different times are kept.

RLS is enabled on `tracking_events`. Background jobs use the service role and pass `organization_id` in the write. No new table is required for the event-flow categories. They can live in the existing `classification` / display layer.

`shipments.last_tracked_at` is the polling due-clock, not proof of a successful scan sync. `last_event_at` is the latest ingested occurrence time.

## 4. India Post API implementation

CONFIRMED request: `POST /tracking/bulk` with `{ "bulk": [article numbers] }`, chunks of 500, bearer token from the tenant connection.

CONFIRMED response handling: `success`, `status_code`, `message`, `data[]`, `booking_details.article_number`, `tracking_details[]` (`date`, `time`, `office`, `officeid`, `event`, `remarks`, `rts`), `del_status`.

Recent local work classifies empty HTTP 200, unmatched articles, and rejected HTTP 400/403/404 separately. It does not call live CEPT.

Booking fields such as `booked_at`, `origin_pincode`, and `destination_pincode` are accepted by the passthrough schema when present. They are not used to replace the shipment destination.

## 5. Synchronization mechanism

- One tracking-sync job per organization, not one authenticated call mixing tenants.
- Page size capped at 500.
- Due filter: never tracked, or `last_tracked_at` older than 15 minutes, or unscanned and older than 2 minutes.
- Patch 1 login-auth hold is separate from bulk HTTP 403.
- Public refresh cache is 60 seconds. Route limit is 20 lookups per minute.
- Webhook idempotency key is `barcode:eventCode:eventTimestamp`, otherwise a body hash.
- Whether India Post is actually posting webhooks to production is UNVERIFIED.

## 6. Redirected shipment support

PARTIALLY IMPLEMENTED.

- The event text is eligible for history storage.
- It does not create a shipment, cancel an order, start RTO, or mark the article delivered.
- Later dispatch, receive, and delivery events on the same AWB still append.
- There is no Redirected display state, no “reached new destination” label, and no rule that a destination-reached scan after a redirect is a new destination.
- The original destination address is not rewritten from tracking scans.

## 7. Confirmed bugs and missing functionality

| ID | Severity | Finding | Status |
| --- | --- | --- | --- |
| F1 | P0 | Reference org has zero stored scans while booking is connected and many sync jobs succeeded, then HTTP 403 | CONFIRMED in production SQL. Not an event-mapper bug |
| F2 | P1 | Dedupe key ignores office, so same event name and timestamp at two offices can drop the second scan | CONFIRMED in the unique index |
| F3 | P1 | Item Redirected has no category or timeline treatment | CONFIRMED |
| F4 | P1 | Item Kept on Hold has no On Hold status | CONFIRMED |
| F5 | P2 | Pickup, picked up, inducted, and booked phrases do not set a pickup/booked category | CONFIRMED. Order is not auto-cancelled |
| F6 | P2 | Item bagged is shown as dispatched movement, not “Processing” | CONFIRMED |
| F7 | P2 | Destination receipt is In Transit, not “Reached Destination” | CONFIRMED. Correctly not Delivered |
| F8 | P2 | Customer timeline stage text can replace the original event sentence | CONFIRMED in `eventDescription` when a stage matches |
| F9 | P3 | No separate refresh priority for out-for-delivery versus booked | CONFIRMED. One due filter |
| F10 | — | Event Download API | MISSING by specification, not a regression |
| F11 | — | Production webhook delivery | UNVERIFIED |

Shopify: tracking sync calls `syncShopifyOrderStage` only for `in_transit` or `delivered`, and only when `autoShopifyFulfillment` is on. Pickup cancellation does not call it. Transit does not create a new fulfillment by itself; that path is the existing stage sync. A full proof that repeated sync never duplicates fulfillments was not re-run in this audit.

## 8. Recommended minimal implementation plan

Do not add a second tracking engine. Do not migrate the shipment status enum.

1. Add an explicit phrase map for the 15 official names, checked before the broad `delivered` / `dispatch` rules.
2. Map them onto existing operational values: pickup and booked stay non-terminal; bagged/dispatch/bag received/item received stay in transit; destination receipt stays in transit with a display label; out for delivery stays out for delivery; on hold becomes a non-delivery hold using the existing delay/NDR-safe path only if it does not mark NDR; redirected is a non-terminal marker that does not start RTO; delivered stays `Item Delivered(Addressee)` only.
3. Keep original `event` text in `event_description`. Put the customer label in the view, not in the stored raw text.
4. Show Item Redirected on the public timeline with a distinct marker. Do not invent a new destination.
5. Leave the unique index unchanged until a separate migration is approved. Document that same-timestamp, different-office scans can collapse. A later additive identity would need a new column or a wider unique key and a backfill plan.
6. Do not change Shopify fulfillment creation. Do not cancel orders on pickup cancellation.
7. Do not call live CEPT or apply a production migration in that change.

## 9. Production risks

- Broadening `delivered` matching could mark hold or redirect scans as delivered. The new phrases must be tested before the generic `delivered` rule.
- Treating on hold as NDR would increment delivery-attempt counts and notify customers. That needs an explicit rule.
- Changing the unique index on a live table needs its own approval.
- HTTP 403 for the reference customer is still an entitlement question. Mapping work will not create those scans.

## 10. Verification strategy

Unit tests with fixture payloads for all 15 official names, a two-office repeat, a redirect followed by another transit cycle, an older event after delivery, pickup cancellation with no order cancel, and an unknown event. No live CEPT. No production writes. No Shopify network calls.

Implementation is waiting for approval.
