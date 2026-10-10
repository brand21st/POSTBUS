# POSTBUS NDR/RTO RELEASE PLAN

**Status:** PREPARED — **DO NOT EXECUTE** without explicit authorization.

## 1. Intended Git commit

Local HEAD at implementation: `531c08834a86bf0d5dd0924020840cae48542e71` plus uncommitted NDR/RTO files. Exact release SHA is the commit created if/when this work is committed. Do not push until asked.

## 2. Changed files (intended)

See implementation report. Isolate from unrelated dirty-tree files (orders, billing, Razorpay, support, bulk booking).

## 3. Required database migrations

**None.**

## 4. Migration rollback

N/A. App rollback restores previous mapper.

## 5. Production backup

If a later reconcile **apply** is approved: snapshot `shipments` (`operational_status`, NDR/RTO columns) and do not delete `tracking_events`. Not required for mapper-only deploy.

## 6. Deployment procedure (not executed)

1. Commit only NDR/tracking files.  
2. Deploy app + worker with the same SHA.  
3. Do not change CEPT credentials, webhook CIDRs, or cron.  
4. Do not enable the India Post webhook.

## 7. Tracking worker compatibility

`TRACKING_POLL_STATUSES` unchanged (FAILED still excluded). New mapper runs on ingest. Older events still skipped by `last_event_at`.

## 8. Feature flags

None. Mapper is always-on after deploy. Reconcile apply remains thrown/disabled.

## 9. Post-deployment monitoring

- `india_post.tracking.sync_ok` / `sync_fail`
- `india_post.tracking.duplicate_event`
- `india_post.tracking.missing_event_time`
- NDR dashboard unclassified vs DELIVERED/NDR counts on **new** scans only

## 10. Rollback conditions

- Delivered(Addressee) still NDR  
- Sudden Shopify fulfillments on OFD-after-NDR  
- Auth retry storms  
- Operational status written for FAILED bookings

## 11. Historical reconciliation

Separate plan. Not part of deploy.

## 12. Merchant-facing impact

New scans classify correctly. Historical dashboard buckets stay low until reconcile. Unclassified card shows honesty, not fake NDR.

## 13. Expected operational_status changes

**New events only** after deploy. Historical nulls unchanged.

## 14. Observability

Existing job logs plus missing-event-time info logs.

## 15. Release acceptance (staging/local)

Mapper tests pass; no production writes; webhook still quarantined.

**PRODUCTION ACCEPTANCE:** hosted non-prod evidence + explicit approval. **Not claimed here.**
