# POSTBUS Tracking Ingestion Fix Report

Date: 2026-10-10  
Base production SHA: `865d295d8401aa55a3b20c6a1f937ceda94d846a`  
Local branch: `fix/tracking-ingestion-p0` (isolated worktree `D:/POSTBUS-NDR-RTO-ISOLATED`)  
**Not pushed. Not deployed. No live CEPT. No production DB writes.**

## Root cause (verified in code + prior audit)

Successful `tracking-sync` jobs called `trackShipment`, which treated HTTP **400/403/404 on a whole bulk page as `continue` with empty `data`**. The worker then stamped **`last_tracked_at` for every AWB in the page**.

`last_tracked_at` was therefore “attempt finished / we will not poll again for 15 minutes”, not “CEPT returned a successful lookup”.

That matches production: 1,580 succeeded jobs / 2h, **0 new tracking events**, **0 `last_event_*`**, **192 `operational_status` NULL**.

HTTP 400 cause is **not proven live** (no CEPT call this work). Code + CEPT doc support these possibilities; isolation handles them without assuming one:

| Hypothesis | Evidence | Handling |
|---|---|---|
| Invalid AWB in a mixed page | 400 skip-all in old code | Binary-split page; good AWBs can still 200 |
| Not owned by this customer | Doc: track only articles booked under credential | Whole page 400 → all `lookup_rejected`, no `last_tracked_at` |
| Invalid payload | Unlikely (`{ bulk: string[] }` matches doc) | Same reject path |
| Fresh article before first scan | Old comment | Single-AWB 400 = reject, retry after interval via **not** stamping success |

Merchant credentials are never mixed: one `india_post_connections` row per org per job.

## Semantics now

| Outcome | HTTP | `last_tracked_at` | Events |
|---|---|---|---|
| `found` | 200 + matching `article_number` | Set by ingest (or empty-history stamp inside ingest) | Persist via existing mapper |
| `absent` | 200, AWB not in `data` | **Set** (successful empty lookup) | None |
| `lookup_rejected` | 400/403/404 after isolation | **Not set** | None |
| 5xx / timeout / 429 | thrown | Not set | Job retry classifier |
| Auth 401 | `PERMANENT_AUTH_ERROR` after bounded login retry | Not set | Enqueue cooldown 30 min |

CEPT documents **only** `POST /access/login` for tokens. There is **no documented refresh URL**. “Token refresh” = reuse access token until 60s before expiry, then password login; **one** tracking HTTP 401 → login once → retry that chunk.

## Files

- `modules/india-post/tracking-bulk.ts` — outcomes + bounded binary isolation (max 32 extra requests default)
- `modules/india-post/tracking-ingest-page.ts` — apply outcomes; stamp only HTTP-success
- `modules/india-post/provider.ts` — `trackShipment` returns `{ data, outcomes }`
- `modules/india-post/tracking-sync.ts` — skip enqueue if open job, auth cooldown, lookup cooldown, or no due AWBs
- `workers/processor.ts` — uses outcomes; all-rejected page throws `TRACKING_LOOKUP_REJECTED` (not retried as TEMPORARY; cooldown 15 min)
- `lib/jobs/retry.ts` — `TRACKING_LOOKUP_REJECTED` permanent for attempt loop
- Optional env (defaults, **no new Coolify secrets required**): `INDIA_POST_TRACKING_ISOLATE_MAX_REQUESTS`, `INDIA_POST_TRACKING_AUTH_COOLDOWN_MS`, `INDIA_POST_TRACKING_LOOKUP_COOLDOWN_MS`

Unchanged: booking, NDR/RTO mapper, Shopify/WhatsApp gates, webhook quarantine, schema.

## Isolation budget

Binary split is finite. If budget hits 0, remaining AWBs are `lookup_rejected` without further HTTP. The whole failed page is **not** retried in a loop inside the job.
