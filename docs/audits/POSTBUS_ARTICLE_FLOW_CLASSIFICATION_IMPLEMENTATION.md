# POSTBUS — Article-Flow Classification Implementation

Date: 18 Oct 2026  
Scope: application code only. No production migration. No live CEPT call. No Shopify write. No deployment.

## A. P0 investigation

See `docs/audits/POSTBUS_TRACKING_P0_MISSING_EVENTS_INVESTIGATION.md`.

Root cause of the empty reference shipment is not the event mapper. The organization has zero `tracking_events`, a connected booking account, and repeated bulk `HTTP_403` failures. Provider entitlement is unverified. This release does not claim that AWB is tracking.

## B. Event classification

Official phrases are matched, case- and punctuation-insensitively, before the generic keyword rules. Return, RTS, and explicit non-delivery rules still win, so existing RTO and NDR behavior stays.

The database `classification` check allows only the current operational enum. The new names are not written there. `articleFlow` and `displayLabel` are derived at read time from the stored event text. `event_description` remains the original India Post text.

| Original event | Article-flow category | Stored operational classification | Customer label |
| --- | --- | --- | --- |
| Pickup Request Raised | PICKUP_REQUESTED | null | Pickup Requested |
| Pickup Assigned | PICKUP_ASSIGNED | null | Pickup Assigned |
| Item Pickup Cancelled | PICKUP_CANCELLED | null | Pickup Cancelled |
| Item Pickedup | PICKED_UP | null | Picked Up |
| Item inducted | INDUCTED | null | Inducted |
| Item Booked | BOOKED | null | Booked |
| Item bagged | BAGGED | DISPATCHED, shipment can move to IN_TRANSIT | Processing |
| Item Dispatched | DISPATCHED | DISPATCHED | In Transit |
| Bag Received | BAG_RECEIVED | IN_TRANSIT | In Transit |
| Item Received | ITEM_RECEIVED | IN_TRANSIT | In Transit |
| Item received at Destination | DESTINATION_REACHED | IN_TRANSIT | Reached Destination |
| Taken out for delivery | OUT_FOR_DELIVERY | OUT_FOR_DELIVERY | Out for Delivery |
| Item Kept on Hold | ON_HOLD | null | On Hold |
| Item Delivered(Addressee) | DELIVERED | DELIVERED | Delivered |
| Item Redirected | REDIRECTED | null | Redirected |

Pickup cancellation does not set an order status. On hold does not set NDR, does not increment attempt counts, and does not emit an in-transit notice. Redirect does not set RTO and does not create a shipment. A later dispatch on the same AWB still applies. Destination receipt is not Delivered. The original destination address is not rewritten.

Shopify stage sync still runs only when the tracking plan emits delivered or in-transit. Hold, redirect, and pickup events do not.

## C. Files changed

- `modules/india-post/event-mapper.ts` — `matchOfficialArticleFlow`, `mapIndiaPostEventToShipmentUpdate`, notice suppression for non-operational article-flow events, identity helpers for the dedupe proposal.
- `modules/india-post/event-mapper.test.ts` — the 15-event matrix, hold, redirect, pickup, URL, and dedupe-gap tests.
- `modules/tracking-pages/customer-track-view.ts` — timeline title is the customer label; original text is kept beside it; header label follows the latest official event.
- `modules/tracking-pages/customer-track-view.test.ts` — destination, dispatch, and booked labels.
- `components/tracking-page/shipment-journey.tsx` — shows `India Post Event: …` under the label.

No shipment enum change. No Shopify fulfillment function change. No tracking job scheduler change. No webhook change.

## D. Database identity

Current unique index `tracking_events_dedupe_uidx` is `(organization_id, shipment_id, event_code, occurred_at)`. Office is not included. Two “Item Received” scans at 10:30 at different offices produce the same key. The second insert hits `23505` and is skipped. That is covered by `currentTrackingEventIdentity` versus `proposedTrackingEventIdentity` in the unit test.

**Migration was not written and was not applied.**

Proposed later change, needing its own approval:

- Add nullable `dedupe_key text`.
- Backfill `dedupe_key` from organization, shipment, normalized event name, `occurred_at`, and normalized office id or office name.
- Add a unique index on `dedupe_key` where it is not null.
- Keep the old index until a collision report shows which existing rows would violate the wider key. Do not drop the old index in the same step.
- Rollback: drop the new index and column. Do not delete event rows.

Risk: a backfill on a large `tracking_events` table needs a lock plan. Rows that already collided were never stored, so backfill cannot restore them.

## E. Verification

`npx vitest run modules/india-post/event-mapper.test.ts modules/tracking-pages/customer-track-view.test.ts`  
**2 files, 27 tests, passed.**

`npx tsc --noEmit` exited 0.

Not executed: live CEPT, production SQL writes, Shopify API, browser pass of `/track`, PGlite cross-tenant insert, webhook replay against a live inbox. Cross-tenant insert protection remains the existing `organization_id` filter. The dedupe office fix is tested only as a key collision, because the index was not changed.

## F. Production readiness

| Area | Status |
| --- | --- |
| Article-flow classification and public labels | Ready for review. Not deployed |
| Reference AWB data | Not ready. P0 open |
| Bulk API authorization | Not ready. CEPT confirmation required |
| Webhook delivery | Unverified |
| Dedupe migration | Not ready. Not applied |
| Shopify fulfillment creation | Unchanged |
| Shipment operational enum | Unchanged |

The tracking system is not production-ready for the reference shipment while India Post bulk tracking returns no stored events for that customer.
