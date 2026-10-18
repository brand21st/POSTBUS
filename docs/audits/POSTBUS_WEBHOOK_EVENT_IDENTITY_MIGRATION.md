# Webhook tracking-event identity — migration proposal

Status: **not applied**. Requires explicit approval. Do not run on production.

## Problem

`tracking_events_dedupe_uidx` is `(organization_id, shipment_id, event_code, occurred_at)`.

`provider_webhook_inbox_event_uidx` is `(organization_id, tracking_number, event_code, event_timestamp)` when those three inbound fields are present.

Office is omitted. Two legitimate “Item Received” scans at the same wall-clock from different offices collide. The application already exposes `proposedTrackingEventIdentity` (includes office) but **does not use it for inserts**.

## Collision analysis

No production index change in this delivery. Historical CEPT Test payloads used synthetic `PB…IN` articles and never wrote `tracking_events`. Real collision rate should be measured with:

```sql
select organization_id, shipment_id, event_code, occurred_at, count(*) as n,
       count(distinct coalesce(office_id, office_name, '')) as offices
from tracking_events
group by 1,2,3,4
having count(distinct coalesce(office_id, office_name, '')) > 1;
```

## Proposed identity

`(organization_id, shipment_id, lower(event_code), occurred_at, coalesce(nullif(office_id,''), nullif(office_name,''), ''))`

Inbox equivalent: add office to the partial unique index only after parser always stores office fields.

## Plan (zero-downtime)

1. Ship application that still inserts under the **current** identity (this PR).
2. Add nullable `office_identity` generated column (or stored text) if needed for a btree key.
3. `CREATE UNIQUE INDEX CONCURRENTLY` on the new key.
4. Backfill cannot invent missing office; rows with empty office stay distinct only by time/code.
5. Drop `tracking_events_dedupe_uidx` only after the new index is valid and the insert path uses the new identity. Leaving the old index in place **will still block** office-distinct inserts.
6. Rollback: keep the old index until the new one is proven; revert application identity helper first.

## Compatibility

Out-of-order events continue to use `canAdvanceShipmentStatus`. Do not rewrite historical `occurred_at`. CEPT wall-clock timestamps without offset remain unparsed (receipt time is used).
