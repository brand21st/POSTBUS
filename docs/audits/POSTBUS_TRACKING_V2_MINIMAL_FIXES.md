# Tracking V2 minimal fixes — deployment notes

Date: 2026-10-21. Live Event Download: **NOT TESTED**. Do not claim production tracking readiness.

## Prerequisites

1. Apply `20261021140000_tracking_sync_checkpoints.sql`.
2. Apply `20261021153000_tracking_lookback_and_event_download_lease.sql`.
3. Keep `INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST` empty until a one-org smoke passes (production empty = off).
4. After read-only HTTP 200 + valid XML, set allowlist to **one** org UUID.
5. Do not enable `*` in production.
6. `JOB_RUNNER=database` unchanged. Booking env unchanged.

## Controlled plan

1. Deploy code with empty allowlist (Event Download off; booking isolated).
2. Apply both tracking migrations.
3. Operator read-only smoke (`INDIA_POST_SMOKE=1`, `INDIA_POST_SMOKE_APPROVED=1`, one org). **Stop on 403.** Treat **204** as empty, not success.
4. If 200 XML contains a known AWB, request approval for a single-shipment DB ingest.
5. Enable that org on the allowlist only.
6. Watch `tracking-sync` jobs, `tracking_lookback_state.last_lookback_success_at`, `tracking_events` inserts, booking jobs.

## Rollback

1. Set `INDIA_POST_EVENT_DOWNLOAD_ORG_ALLOWLIST` empty.
2. Optionally `auto_tracking_sync=false`.
3. Leave additive tables in place.
4. Do not revert booking configuration.

## Health

- `background_jobs` `tracking-sync` `HTTP_403` → entitlement blocker.
- Overlap `last_success_at` vs lookback `last_lookback_success_at` must move independently.
- Dashboard Refresh must not POST on the 15s GET poll.
