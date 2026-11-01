# PostBus India Post Tracking Audit

**Document status:** Evidence-based read-only audit plus authorized Wave 1–3 implementation notes  
**Approach document:** India Post – External Integrations – Approach Document, updated 30.07.2026  
**Audit branch / SHA at inspection:** `india-post-true-bulk-candidate` @ `531c08834a86bf0d5dd0924020840cae48542e71`  
**Production Supabase:** `hgacoeoovjxkzfbesmvl` — **not queried, not migrated, not used for tests**  
**Classification:** VERIFIED | PARTIALLY VERIFIED | UNVERIFIED | NOT IMPLEMENTED | NOT APPLICABLE

This report does not claim production readiness from inspection alone.

---

## 1. Existing tracking architecture

### 1.1 Environment

| Item | Verified behavior | Confidence |
| --- | --- | --- |
| Runtime | Next.js 16.3.8, React 19.2.8, Vitest 4; `JOB_RUNNER=database` default | VERIFIED |
| Local `.env.local` | Points at production Supabase `hgacoeoovjxkzfbesmvl` | VERIFIED |
| Isolated staging | Local Postgres `127.0.0.1:55432` (`infra/STAGING.md`); CEPT stub | VERIFIED (capability) |
| CI | No GitHub Actions workflows | VERIFIED |
| Jobs | Coolify drains `tracking-sync` and `india-post-events` via `POST /api/cron/jobs` | VERIFIED |

### 1.2 Lifecycle

India Post booking → AWB on `shipments` → optional `tracking-sync` job after book → `POST /beextcustomer/v1/tracking/bulk` → `applyIndiaPostTracking` → `tracking_events` + shipment status → dashboard / public page → Shopify / WhatsApp side effects.

Parallel path: unauthenticated `POST /api/v1/webhooks/india-post/{connectionId}/events` → `provider_webhook_inbox` → `india-post-events` job → same apply function.

| Stage | File | Function | Tables / API |
| --- | --- | --- | --- |
| Booking / AWB | `modules/india-post/booking-run.ts` | `runIndiaPostBooking` | `shipments.barcode` |
| Bulk track | `modules/india-post/provider.ts` | `IndiaPostProvider.trackShipment` | `POST …/v1/tracking/bulk` |
| Ingest | `modules/india-post/apply-tracking.ts` | `ingestBulkTrackingArticle`, `applyIndiaPostTracking` | `tracking_events`, `shipments`, `orders` |
| Map | `modules/india-post/event-mapper.ts` | `mapIndiaPostEventToShipmentUpdate`, `planTrackingUpdate` | — |
| Webhook HTTP | `lib/api/v1/inbound-webhooks.ts` | `handleInboundWebhook` | public POST |
| Webhook persist | `modules/india-post/webhook.ts` | `acceptIndiaPostWebhook` | RPC `accept_india_post_webhook` |
| Webhook apply | `modules/india-post/webhook.ts` | `processIndiaPostInboxEvent` | `provider_webhook_inbox` |
| Jobs | `workers/processor.ts` | `syncTracking`, `india-post-events` | `background_jobs` |
| Public | `modules/tracking-pages/public.ts` | `refreshLiveTracking` | on-demand CEPT |
| Shopify / WA | `modules/india-post/tracking-effects.ts` | `enqueueTrackingStageSideEffects` | jobs + Shopify Admin |

### 1.3 Audit questions

| Question | Answer | Confidence |
| --- | --- | --- |
| When does tracking begin? | After successful book (job enqueue) and/or first webhook / public lookup | VERIFIED |
| First tracking request? | `trackShipment` from booking recovery, `tracking-sync`, NDR sync, or public live poll | VERIFIED |
| Automatic? | If `auto_tracking_sync` (default true) | VERIFIED |
| Scheduled? | Drain runs queued jobs only; no recurring enqueue existed at audit | VERIFIED |
| All active shipments? | `syncTracking` selected all pollable org barcodes in one query (no page) | VERIFIED |
| Failed request retry? | Job retry 5 attempts, backoff + jitter; 401 permanent | VERIFIED |
| Duplicate events? | Unique `(organization_id, shipment_id, event_code, occurred_at)` + inbox hash | VERIFIED |
| Delivered still polled? | `DELIVERED` not in `TRACKING_POLL_STATUSES`; NDR/RTO still polled until `RTO_DELIVERED` | VERIFIED |
| Older event overwrite newer status? | `planTrackingUpdate` skips status if event older than `last_event_at` | VERIFIED |
| Cross-merchant shipment access? | Dashboard/API org-scoped; public AWB lookup is global by design (redacted) | VERIFIED |

---

## 2. India Post document compliance matrix

Source: `New_Customer_Integrations_approach_document_31052026 -new.docx` (footer: Updated on 30.07.2026). Section numbers 1.1 / 1.6 / 1.8 in the task map to Session API, Bulk/Individual Tracking API, and Webhook Payload in the file.

| Capability | Document | Implementation at audit | Matrix |
| --- | --- | --- | --- |
| `POST /v1/access/login` Bearer | Session API; ~15 minute access token | Implemented | SUPPORTED |
| Refresh token | Returned; no refresh URL in this document | Stored encrypted, unused | PARTIALLY SUPPORTED |
| Persist session on tracking | Secure storage | Booking/label persist; tracking login in-memory only | PARTIALLY SUPPORTED |
| `POST /v1/tracking/bulk` `{ bulk }` max 500 | Explicit | Correct URL, method, body, chunk 500 | SUPPORTED |
| Own-customer articles | Explicit | Per-org credentials + barcode match | SUPPORTED |
| Partial / 400 tracking | Undocumented | 400/403/404 skip whole chunk | PARTIALLY SUPPORTED |
| `officeid`, `remarks`, `rts` | Sample tracking_details | Omitted from typed ingest | PARTIALLY SUPPORTED |
| SFTP | Dedicated folders + outbound XML events | Not implemented | NOT SUPPORTED |
| `/event/download` XML | Summary only; no request contract | Not implemented | NOT SUPPORTED / BLOCKED BY SPECIFICATION |
| Webhook JSON fields | Sample payload | Parser uses documented names only | SUPPORTED (parse) |
| Webhook HMAC / mTLS / shared secret | **Not specified** | None | BLOCKED BY SPECIFICATION |
| Static IP whitelist | Required for CEPT server access to webhook | No app-level allowlist at audit | BLOCKED BY SPECIFICATION |
| Official event catalogue | “Attached list of events” | Attachments not in supplied docx | BLOCKED BY SPECIFICATION |

**Clarifications for India Post (`integrations.cept@indiapost.gov.in`):** refresh-token endpoint vs re-login; Event Download method/query/cursor; official event-code list; webhook authentication; CEPT egress IPs; rate limits; timezone of webhook `event_date`/`event_time`.

---

## 3. Gap analysis (findings)

### CONFIRMED DEFECTS

#### TRK-001

| Field | Value |
| --- | --- |
| Component | India Post webhook receiver |
| Expected | No unauthenticated production webhook; do not invent HMAC |
| Actual | `POST /api/v1/webhooks/india-post/{uuid}/{booking\|events}` has no signature, mTLS, or IP check. RPC `accept_india_post_webhook` granted to `anon`. |
| Document | Webhook Payload; no auth contract |
| Repository | `lib/api/v1/inbound-webhooks.ts`, `modules/india-post/webhook.ts`, `supabase/migrations/20260920104500_accept_india_post_webhook.sql` |
| Evidence | Code review |
| Severity | P0 |
| Customer impact | Connection UUID (shown in dashboard) is enough to inject events for that org |
| Recommended correction | Optional CIDR allowlist when CEPT IPs are known; match `bulk_customer_id`; keep webhook **untrusted** until spec; do not invent HMAC |
| Regression risk | CEPT posts fail if allowlist is wrong |
| Test requirements | Allowlist on/off; customer-id mismatch |
| Confidence | VERIFIED |

#### TRK-002

| Field | Value |
| --- | --- |
| Component | Background `tracking-sync` |
| Expected | Reliable scheduled sync of active shipments |
| Actual | Job enqueued per book; `syncTracking` ignores entity id and polls entire org; no recurring enqueue |
| Repository | `workers/processor.ts` `syncTracking` |
| Severity | P1 |
| Customer impact | Statuses stall after booking if webhooks are unused |
| Recommended correction | One org-level job, deduped, cron-enqueued, paginated, skip recently synced |
| Confidence | VERIFIED |

#### TRK-003

| Field | Value |
| --- | --- |
| Component | Token management |
| Expected | ~15 min token, refresh, no login stampede |
| Actual | Tracking `token()` re-logins; does not persist; refresh unused; no single-flight |
| Repository | `modules/india-post/provider.ts`, `modules/india-post/session.ts` |
| Severity | P1 |
| Customer impact | Extra logins; workers race; expiry thrash |
| Recommended correction | `ensureSession` + persist + in-process lock |
| Confidence | VERIFIED |

#### TRK-004

| Field | Value |
| --- | --- |
| Component | Event mapping |
| Expected | Hold / RTS preserved accurately |
| Actual | `Item Kept on Hold` does not change status (acceptable without catalogue). `rts` ignored. Remarks ignored. |
| Document | Bulk tracking sample |
| Repository | `modules/india-post/event-mapper.ts`, `apply-tracking.ts` |
| Severity | P1 |
| Recommended correction | Persist officeid/remarks/rts; `rts: true` → return initiated; hold stays timeline-only (no new enum) |
| Confidence | VERIFIED vs sample |

#### TRK-005

| Field | Value |
| --- | --- |
| Component | `del_status` |
| Expected | Do not invent delivery timestamps |
| Actual | Synthesizes `ITEM_DELIVERED` with `new Date()` |
| Repository | `ingestBulkTrackingArticle` |
| Severity | P1 |
| Recommended correction | Use latest event time or `delivery_confirmed_on` |
| Confidence | VERIFIED |

#### TRK-006

| Field | Value |
| --- | --- |
| Component | Public live tracking |
| Expected | Apply only matching article |
| Actual | Falls back to `result.data[0]` |
| Repository | `modules/tracking-pages/public.ts` |
| Severity | P1 |
| Recommended correction | Skip ingest if article_number does not match |
| Confidence | VERIFIED |

#### TRK-007

| Field | Value |
| --- | --- |
| Component | Timestamp parse |
| Expected | Parse documented ISO `date` fields |
| Actual | Concatenates `date`+`T`+`time` even when `date` is already ISO-Z; fallback often saves it |
| Repository | `bulkEventOccurredAt` |
| Severity | P2 |
| Confidence | VERIFIED |

#### TRK-008 – TRK-012

Dedup fingerprint omits office; older events still bump `last_tracked_at`; unbounded shipment select; failed inbox not retried; public 60s cache labeled live. Severity P2–P3. See plan for detail.

### ARCHITECTURAL RISKS

- Webhook cannot be primary until CEPT auth/IP contract exists.
- Shopify/WhatsApp side effects are best-effort after persist.
- Developer env pointed at production.

### DOCUMENTATION GAPS / UNVERIFIED

Event catalogue attachments; Event Download contract; whether production already registered webhook URLs with CEPT; production job backlog (not queried).

---

## 4. Security audit (tracking)

| Control | Result | Confidence |
| --- | --- | --- |
| Tenant queries on dashboard tracking | `organization_id` filter | VERIFIED |
| Webhook process shipment lookup | Org-scoped barcode / tracking_number | VERIFIED |
| Cross-org webhook | Connection → one org | VERIFIED |
| Public page | Redacts beyond city, status, timeline | VERIFIED |
| `tracking_events` RLS | Enabled | VERIFIED |
| Credential isolation | One `india_post_connections` row per org | VERIFIED |
| Webhook authenticity | UUID only; `bulk_customer_id` not verified at audit | VERIFIED gap |
| HMAC | Not in CEPT document — must not invent | VERIFIED |

---

## 5. Status mapping review (sample events only)

Official attachments were **not** in the supplied document. Unknown events must remain on the timeline without forcing status.

| Raw | Mapped at audit | Intended |
| --- | --- | --- |
| Item Booked | scan only | BOOKED / scan |
| Item Received / at Destination | IN_TRANSIT | IN_TRANSIT |
| Item Dispatched / bagged / BAG_CLOSE | DISPATCHED → IN_TRANSIT | IN_TRANSIT |
| Taken out for delivery | OUT_FOR_DELIVERY | OUT_FOR_DELIVERY |
| Item Kept on Hold | unknown | timeline + remarks; no false delivery |
| Pickup Request Raised | unknown | scan only |
| rts true | ignored | RETURN_INITIATED (`RTO`) |
| Item Delivered | DELIVERED | DELIVERED |
| Return phrases | RTO* | do not treat RTS start as completed return |

---

## 6. Background synchronization review

- Infrastructure: database `background_jobs` + Coolify minute drain. Redis not required.
- Retries: bounded, jittered.
- Gap: no scheduler, no pagination, tracking tokens not persisted.
- Hybrid target: webhook primary **only after** security contract; bulk API secondary; Event Download blocked.

---

## 7. Implementation waves (authorized)

1. Webhook: optional CIDR allowlist; `bulk_customer_id` consistency; remain untrusted without IPs. No HMAC.
2. Ingest: ISO dates; officeid/remarks/rts; rts→RTO; hold timeline-only; no `data[0]`; no `now()` delivery stamp.
3. Tokens + org-level bounded scheduled sync on existing jobs.
4. Not in this change: Event Download, SFTP, catalogue rewrite, production deploy.

---

## 8. Staging test plan

Execute with mocks / local staging only. Never production `hgacoeoovjxkzfbesmvl`. Never real customer WhatsApp.

See `POSTBUS_TRACKING_PRODUCTION_READINESS.md` after test execution.

---

## Addendum — Wave 4 (2026-10-10)

HEAD at implementation: `531c08834a86bf0d5dd0924020840cae48542e71` (`india-post-true-bulk-candidate`). Wave 4 is uncommitted on this SHA.

**TRK-020 closed in code:** HTTP ingest is quarantined (HTTP 200 `{ accepted: false, quarantined: true }`) without `INDIA_POST_WEBHOOK_ALLOWED_CIDRS`. No `accept_india_post_webhook`, no `india-post-events`, no shipment mutation. HMAC still **BLOCKED BY SPEC**.

**TRK-021 residual:** source IP prefers `cf-connecting-ip`, else leftmost `x-forwarded-for`. That hop is only trustworthy if Traefik (or equivalent) is the sole edge and overwrites forwarded headers. Not GREEN webhook.

**TRK-022:** Bulk `POST /v1/tracking/bulk` JSON is Zod-validated; HTTP 200 + `success: false` is a failure; articles must match requested barcodes.

**TRK-023:** Tracking login uses DB `acquire_india_post_booking_lock` outside the in-process session queue. Busy/unavailable lock fails the attempt (`TEMPORARY_PROVIDER_FAILURE`); no unlocked login fallback.

**TRK-024:** Public cache hits return `liveTracking: "cached"` and a last-updated message, not live `ok`.

Primary path remains authenticated Bulk API. Event Download / SFTP / invented HMAC still out of scope. See `POSTBUS_TRACKING_FINAL_PRODUCTION_REPORT.md`.
