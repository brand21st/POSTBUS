# POSTBUS NDR/RTO RECONCILIATION PLAN

**Status:** PREPARED — **DO NOT RUN ON PRODUCTION**

Production project `hgacoeoovjxkzfbesmvl` is hard-blocked by `assertReconcileTargetIsolated`.

## Prefer replay of stored events

Do not fetch CEPT first. `tracking_events` already hold raw scans. Use `dryRunShipmentReconcile` / `projectShipmentFromEvents` only.

## Safety properties

1. Organization scoped  
2. Shipment scoped  
3. Dry-run default  
4. Before/after projections  
5. Idempotent projection (duplicate event_code+occurred_at does not increment NDR twice)  
6. Raw events preserved  
7. No bookings, AWB edits, WhatsApp, Shopify, billing  
8. FAILED/CANCELLED skipped  
9. Ambiguous (hold, redirect, unknown) proposed as unclassified, not NDR  
10. `applyReconcileWrites()` throws until a **later explicit** approval implements writes

## Suggested order (after mapper deploy)

1. Deploy corrected mapper (separate approval).  
2. Verify newly ingested `Item Delivered(Addressee)` → DELIVERED.  
3. Verify `operational_status` persistence on new events.  
4. Generate org-scoped dry-run from persisted events.  
5. Review all proposed **terminal** changes (DELIVERED / NDR / RTO*).  
6. Separate production write authorization.  
7. Small approved batch.  
8. Verify counts and event integrity.  
9. Continue bounded batches only after success.

## Conceptual dry-run examples (not production rows)

- Null operational + latest `Item Delivered(Addressee)` → propose DELIVERED.  
- Null operational + `Item Kept on Hold` → retain unclassified; not NDR.

## Side-effect rule

Replay must never call `enqueueTrackingStageSideEffects`, order updates, or Shopify. The current dry-run module does not import those handlers.
