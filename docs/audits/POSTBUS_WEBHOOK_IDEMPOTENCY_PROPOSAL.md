# Webhook idempotency proposal

Not a migration. Do not apply this to production without a separate approval.

## Current behavior

`provider_webhook_inbox_event_uidx` is unique on `(organization_id, tracking_number, event_code, event_timestamp)` when all three event fields are present. Office is not included.

`tracking_events_dedupe_uidx` is unique on `(organization_id, shipment_id, event_code, occurred_at)`. Office is not included.

Identical request bodies already collapse on `(organization_id, payload_hash)`.

CEPT webhook `event_date` / `event_time` have no documented offset, so those inbox rows now store `event_timestamp` null. The partial event unique index does not apply to them. Identical retries still collapse on the payload hash. Two different bodies for the same scan do not.

## Proposed change, after approval

Include `event_office_facility_id` (and the tracking-event `office_id`) in both unique keys so two offices at the same instant remain distinct. Keep the payload-hash key.

Do not drop the existing indexes in the same step as application code. Backfill and a duplicate check are required first, because current rows may already have collapsed.
