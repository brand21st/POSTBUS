# PostBus Tracking Production Readiness

**Date:** 2026-10-10  
**Branch:** `india-post-true-bulk-candidate`  
**Forbidden production project:** `hgacoeoovjxkzfbesmvl` — **not used**  
**Live CEPT / production deploy:** not performed  
**Conclusion:** **YELLOW** — functional unit evidence for Waves 1–3; webhook authenticity and hosted staging remain outstanding.

A GREEN result would require an isolated hosted staging project (not `hgacoeoovjxkzfbesmvl`), CEPT IP/auth confirmation, and executed side-effect tests. This run used in-process Vitest only (436 passed, 1 skipped in the India Post / NDR / Shopify / cron slice).

---

## Checklist

| Item | Status |
| --- | --- |
| Critical security findings resolved | Partial — optional CIDR + customer-id check; **HMAC still BLOCKED BY SPEC**; empty CIDR = untrusted receiver |
| Tracking mappings validated | Partial — documented sample strings + unit tests; official catalogue still missing |
| Webhook authentication verified | **No** — India Post did not specify HMAC/mTLS/token |
| Multi-tenant isolation tested | Unit tests (NDR sync other tenant, webhook unknown barcode). Cross-tenant staging **not executed** |
| Event deduplication tested | Unit (23505 / inbox duplicate). Repeated live webhook **not executed** |
| Background sync recovery tested | Unit enqueue/dedup. Worker restart / Coolify drain **not executed** |
| Database migrations | None in this change |
| Booking flow unaffected | Existing booking tests still passed in the Vitest slice |
| Shopify regression | Existing `orders.test.ts` fulfillment duplicate coverage passed; no live Shopify |
| WhatsApp side effects | Not sent. Duplicate-job logic unchanged; not live-tested |
| Monitoring | Existing job logs only |
| Rollback | Revert this commit. Inbound India Post webhooks stay quarantined without CIDR env. |
| Staging tests | **Unit mocks only** — local Postgres cluster and CEPT stub were not started |
| India Post specifications | Event Download, event catalogue, webhook auth, rate limits still open |

---

## Isolated execution evidence

**Command:** `npx vitest run modules/india-post modules/ndr-rto/service.test.ts modules/tracking-pages/public.test.ts modules/shopify/orders.test.ts lib/api/v1/ndr-rto.test.ts app/api/cron/jobs/route.test.ts`

**Result:** 42 files, **436 passed**, 1 skipped (`uat-track` live CEPT). Duration ~9.5s.

No writes to production Supabase. No CEPT production URL. No customer WhatsApp.

---

## Scenario matrix (plan Phase 16)

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| 1 | Valid tracking response | PASSED | `apply-tracking.test.ts`, provider session tests |
| 2 | Empty tracking response | PASSED | `provider.session.test.ts` 400 → empty; sync stamps `last_tracked_at` |
| 3 | Invalid AWB | PASSED | Matching helper returns null; webhook unknown-shipment |
| 4 | Unauthorized AWB | PASSED | Org-scoped lookup; webhook `unknown-shipment` |
| 5 | Batch of 500 | PASSED | `http.test.ts` chunk 500 |
| 6 | Batch exceeding 500 | PASSED | 501 → 2 chunks |
| 7 | Partial API failure | PARTIAL | 400/403/404 skip chunk (pre-existing); not per-article |
| 8 | Authentication expiration | PASSED | `ensureSession` re-login + persist path; 60s skew |
| 9 | Concurrent token refresh | PASSED (in-process) | `withProcessSessionLock` serializes one connection |
| 10 | API timeout | PASSED | Abort mapped retryable in `retry.ts` (existing) |
| 11 | Rate-limit response | PASSED | `HTTP_429` retryable (existing classifier) |
| 12 | Duplicate webhook event | PASSED | `webhook-process.test.ts` duplicate skip |
| 13 | Out-of-order events | PASSED | `planTrackingUpdate` older scan |
| 14 | Unknown event code | PASSED | Hold/booked stay timeline-only |
| 15 | Delivered shipment | PASSED | Mapper + RTO-delivered tests |
| 16 | Hold event | PASSED | Sample hold + remarks; not NDR/delivered |
| 17 | Failed delivery attempt | PASSED | NDR webhook process test |
| 18 | RTS initiation | PASSED | `rts: true` → RTO |
| 19 | Return completion | PASSED | Delivered after return → `RTO_DELIVERED` |
| 20 | Webhook outage | NOT RUN | Relies on scheduled bulk sync; drain not live |
| 21 | Background sync recovery | PARTIAL | Cron enqueue + idle skip unit tests |
| 22 | Worker restart | NOT RUN | Existing `claim_background_jobs` SKIP LOCKED |
| 23 | Concurrent synchronization | PARTIAL | Session lock; job idle skip |
| 24 | Cross-tenant access | PASSED (unit) | NDR other-tenant 404 |
| 25 | Duplicate Shopify fulfillment | PASSED | Existing Shopify unit test |
| 26 | Duplicate WhatsApp | NOT RUN live | Existing SUCCEEDED job suppression |
| 27 | Timeline ordering | PASSED | Ingest sorts by `bulkEventOccurredAt` |
| 28 | Stale tracking display | PARTIAL | `last_tracked_at` on shipment page; public 60s cache still labeled live |

---

## What shipped in code (Waves 1–3)

- Inbound India Post webhooks acknowledge HTTP and quarantine ingest until CEPT documents HMAC, mTLS, or egress IPs. No CIDR env. No invented HMAC.
- Reject webhook `bulk_customer_id` that disagrees with the connection customer id.
- ISO bulk `date` parse; persist `officeid` / remarks / `rts`; no `data[0]` article fallback; no wall-clock synthetic delivery when a scan time exists.
- Persist CEPT tokens on tracking login; in-process session lock.
- Org-level `tracking-sync` enqueue from `POST /api/cron/jobs` (when types include tracking-sync or all), idle-deduped, paged, skip recently tracked.

**Do not enable a production CIDR allowlist until India Post publishes egress IPs.** Wrong CIDRs will drop legitimate webhooks.

**Do not treat webhook as the primary production mechanism** until the security contract is confirmed.

---

## Rollback

1. Revert the tracking change set.
2. Inbound webhook ingest stays quarantined until a verified CEPT sender authenticator exists.
3. Scheduled enqueue is skipped when `hasAdminClient()` is false; Coolify `JOB_TYPES` without `tracking-sync` also skips enqueue.

---

## Next gates for GREEN

1. Isolated hosted staging (not `hgacoeoovjxkzfbesmvl`).
2. Written CEPT webhook IPs and/or other verified auth.
3. Execute remaining NOT RUN rows against mocks + CEPT UAT with authorized credentials only.
4. Confirm booking + WhatsApp + Shopify on that staging org with synthetic data.

---

## Addendum — Wave 4 (2026-10-10)

YELLOW history above is retained. Wave 4 unit gates:

| Item | Status |
| --- | --- |
| Empty CIDR webhook | Quarantined (200, no persist) |
| Configured CIDR mismatch | 403, no RPC |
| Bulk Zod + `success: false` | Failed closed in unit tests |
| Article mismatch | Still no `data[0]` fallback |
| Session lock busy | No login |
| Cron enqueue | Existing tests still pass |
| NDR tenant isolation | Existing tests still pass |
| Shopify duplicate fulfillment | Existing tests still pass |

**Slice:** `npx vitest run modules/india-post modules/ndr-rto lib/api/v1/ndr-rto.test.ts modules/shopify app/api/cron/jobs/route.test.ts` → **46 files, 465 passed, 1 skipped**. Targeted Wave 4 files: **11 files, 109 passed**.

`npx tsc --noEmit` still fails only on unrelated `scripts/seed-test-org-*.mts` import-extension errors.

Classification unchanged at product level: **YELLOW / webhook BLOCKED**. Bulk-API-only is eligible for **controlled staging deploy** after this unit gate — **not GREEN**, no production deploy.
