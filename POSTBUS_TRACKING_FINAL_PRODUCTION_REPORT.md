# PostBus Tracking — Final Production Report (Wave 4)

**Date:** 2026-10-10  
**Branch:** `india-post-true-bulk-candidate`  
**HEAD:** `531c08834a86bf0d5dd0924020840cae48542e71`  
**Wave 4:** implemented on this HEAD (uncommitted at report time)  
**Forbidden production project:** `hgacoeoovjxkzfbesmvl` — **not used**  
**Production deploy / Coolify / CEPT production / live WhatsApp:** **not performed**

## Classification

**YELLOW / BLOCKED on webhook.**  
Authenticated **Bulk API** is the primary tracker and is **ready for a controlled staging deploy** only in the sense that unit gates passed. This is **not GREEN**.

HMAC, Event Download XML, and SFTP remain **BLOCKED BY SPEC**. Do not invent them. Do not set `INDIA_POST_WEBHOOK_ALLOWED_CIDRS` until India Post publishes official egress IPs.

## Primary vs quarantine

```
cron POST /api/cron/jobs
  → enqueueDueTrackingSyncJobs
  → claim_background_jobs
  → POST /beextcustomer/v1/tracking/bulk
  → Zod + article match
  → applyIndiaPostTracking

CEPT webhook POST
  → quarantine unless CIDRs configured
```

Empty CIDR: HTTP **200** `{ accepted: false, quarantined: true, inboxEventId: null }` so CEPT is not hammered with 403 loops. No RPC, no jobs, no shipment writes.

Configured CIDR: IP must match (`cf-connecting-ip`, else **leftmost** `x-forwarded-for`). Customer-id mismatch stays **403**. `x-forwarded-for` is spoofable unless Traefik (Coolify edge) is trusted and overwrites the header. That is documented, not a GREEN webhook.

## Files (Wave 4)

| Area | Path |
| --- | --- |
| Quarantine | `modules/india-post/webhook-allowlist.ts`, `webhook.ts`, `webhook-process.test.ts`, `webhook-allowlist.test.ts` |
| Bulk Zod | `modules/india-post/tracking-response.ts`, `tracking-response.test.ts`, `provider.ts`, `provider.session.test.ts` |
| Login lock | `modules/india-post/session.ts`, `session.test.ts` (reuses `booking-lock.ts`) |
| Ingest source | `modules/india-post/apply-tracking.ts`, `workers/processor.ts`, `modules/ndr-rto/service.ts`, `modules/tracking-pages/public.ts` |
| UI honesty | `types/api.ts` (`liveTracking: "cached"`), `modules/tracking-pages/public.ts`, `customer-track-view.ts` |
| Metrics | `logInfo`/`logError`: `india_post.webhook.quarantined`, `india_post.tracking.sync_ok` / `sync_fail`, `india_post.tracking.duplicate_event` |
| Env comments | `lib/env.ts`, `.env.example` |

## Tests recorded

**Targeted:**

```
npx vitest run modules/india-post/webhook-allowlist.test.ts modules/india-post/webhook-process.test.ts modules/india-post/tracking-response.test.ts modules/india-post/provider.session.test.ts modules/india-post/session.test.ts modules/india-post/apply-tracking.test.ts modules/india-post/tracking-sync.test.ts lib/api/v1/ndr-rto.test.ts modules/ndr-rto/service.test.ts modules/shopify/orders.test.ts app/api/cron/jobs/route.test.ts
```

→ **11 files, 109 passed**, ~1.6s.

**Slice (india-post / ndr / shopify / cron):**

```
npx vitest run modules/india-post modules/ndr-rto lib/api/v1/ndr-rto.test.ts modules/shopify app/api/cron/jobs/route.test.ts
```

→ **46 files, 465 passed, 1 skipped** (`uat-track` live CEPT), ~11s.

Must-run coverage: fail-closed webhook; CIDR mismatch; bulk Zod; HTTP 200 `success: false`; article mismatch; ISO date; rts/hold; session lock busy; cron enqueue; NDR tenant isolation; Shopify duplicate fulfillment.

**tsc:** `npx tsc --noEmit` — Wave 4 modules clean. Existing failures only in unrelated `scripts/seed-test-org-invoices.mts` and `scripts/seed-test-org-labels.mts` (`.ts` import extensions). Production `next build` skipped (would need production env).

No production DB. No hosted staging.

## Bulk-API vs webhook status

| Path | Status |
| --- | --- |
| Bulk tracking API | Unit-ready; token persist + DB booking lock + in-process queue; Zod; barcode match |
| Org `tracking-sync` jobs | Enqueue/pagination unit-tested; Coolify drain **not** proven in prod |
| Webhook | Quarantined by default; not a production ingest path |
| Event Download / HMAC | BLOCKED BY SPEC |

## Blocked (do not fake)

- Live CEPT UAT against real credentials
- Isolated hosted staging (not `hgacoeoovjxkzfbesmvl`)
- 1k–100k load
- Real customer WhatsApp
- Coolify drain proving jobs consume in production
- Official CEPT webhook IPs / mTLS / HMAC

## Runbook (ops)

**India Post outage / 5xx / `success: false` (non-4xx):** tracking-sync jobs retry with existing backoff. Logs: `india_post.tracking.sync_fail`, `job.failed`. Public page: `liveTracking: "unavailable"`. Do not enable webhook as a workaround.

**Auth fail (login 401/403, missing tokens):** `PERMANENT_AUTH_ERROR` or provider error. DB lock unavailable (`rpc_missing` / timeout) **fails the tracking attempt** — same as booking; never login unlocked. Check `india_post_connections` and `acquire_india_post_booking_lock`.

**Backlog:** cron enqueues org `tracking-sync` when idle; full pages re-enqueue. Watch `background_jobs` where `job_type = tracking-sync` stuck in PENDING/RUNNING. `JOB_TYPES` must include `tracking-sync` (or all). `last_tracked_at` skip interval is env-bounded.

**Webhook quarantine:** empty CIDRs is expected. Log `india_post.webhook.quarantined`. If CEPT loops on non-200, keep 200 quarantine. If CEPT publishes IPs, set `INDIA_POST_WEBHOOK_ALLOWED_CIDRS` and verify Traefik overwrites `x-forwarded-for` / prefer `cf-connecting-ip` only if Cloudflare is actually in front. Wrong CIDRs drop legitimate posts (403).

**429:** `Retry-After` parsed onto the error; job retry delay uses it when present, else `delayForAttempt`.

**Duplicate events:** unique `(org, shipment, event_code, occurred_at)`; `23505` logged as `india_post.tracking.duplicate_event`, no NDR increment.

## Rollback

1. Revert the Wave 4 change set.  
2. Leave CIDRs empty (quarantine) — do not “fail open.”  
3. Disable `tracking-sync` in Coolify `JOB_TYPES` to stop Bulk polls.

## What this report is not

Not a production go-live. Not a GREEN webhook. Not evidence of CEPT UAT, load, or Coolify drain.
