# POSTBUS Tracking Single-Org Canary Plan

**DO NOT EXECUTE until an operator names the organization in writing.**

This plan is for **after** `fix/tracking-ingestion-p0` is deployed. It is not a fleet re-sync and not historical reconciliation.

## Target

- **One** explicitly approved organization: _TBD by operator_ (must be `india_post_connections.status = CONNECTED`, `environment = PRODUCTION`, `auto_tracking_sync = true`, credentials believed valid).
- Do **not** use an org with recent `PERMANENT_AUTH_ERROR` until credentials are fixed.
- Sample: **at most 5** barcoded shipments in poll statuses, preferably including at least one that already has historical `tracking_events` (e.g. prior `Item Delivered(Addressee)`).

## Limits

| Control | Value |
|---|---|
| Jobs | **1** `tracking-sync` for that org only |
| AWBs | ≤ 5 (temporarily lower `INDIA_POST_TRACKING_SYNC_PAGE_SIZE` is optional; default 500 is unsafe for first canary — prefer a **code-path sample** or a one-off admin drain after selecting 5 rows) |
| Isolation requests | ≤ 8 (`INDIA_POST_TRACKING_ISOLATE_MAX_REQUESTS=8` for canary) |
| Concurrency | existing drain (do not raise) |
| CEPT | production `app.indiapost.gov.in` only for that org’s stored credentials |
| Webhooks | remain quarantined |
| Shopify / WhatsApp | no extra enablement; existing gates apply |

Recommended first canary: temporarily set page size **5** in Coolify **only if approved**, then revert. Do not leave page size at 5.

## Expected evidence (success)

Logs (no secrets):

- `india_post.tracking.sync_ok` with `ingested > 0` and/or `absent > 0`
- `rejected = 0` or mixed with `ingested > 0` (job still succeeds)

Database (read-only checks after):

- New `tracking_events` rows for the sample (or duplicate 23505 if history already stored)
- `classification` populated on **new** inserts
- `operational_status` set when mapper classifies (Delivered(Addressee) → DELIVERED, not NDR)
- `last_tracked_at` only on `found`/`absent`
- No `last_tracked_at` bump on rejected-only AWBs
- Other organizations unchanged (`operational_status` / event counts)

## Failure thresholds — STOP

Stop the canary (do not enqueue a second org, do not raise page size) if:

- HTTP 401 / `PERMANENT_AUTH_ERROR`
- Entire sample `lookup_rejected` / `TRACKING_LOOKUP_REJECTED`
- Any booking job failure in the same window (unrelated blast radius)
- Shopify/WhatsApp unexpected enqueue for NDR/RTO-only scans
- Isolation request count saturates budget on 5 AWBs (investigate before retry)
- Any other tenant’s shipments change

## Rollback

Redeploy application SHA `865d295d8401aa55a3b20c6a1f937ceda94d846a`.  
Do **not** DELETE `tracking_events` or NULL out `operational_status` written by the canary (non-destructive). Old code ignores extra classification on insert; `last_tracked_at` remains a poll watermark.

## Forbidden

Fleet re-sync, historical reconcile apply, CEPT webhook CIDRs, credential rotation in git, live Shopify/WhatsApp tests.
