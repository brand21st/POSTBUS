# POSTBUS Tracking Ingestion Test Report

Branch: `fix/tracking-ingestion-p0`  
Worktree: `D:/POSTBUS-NDR-RTO-ISOLATED`  
Mocks only. PGlite for `modules/ndr-rto/db.test.ts`.

## Vitest

```
npx vitest run modules/india-post/tracking-bulk.test.ts modules/india-post/tracking-ingest-page.test.ts modules/india-post/tracking-sync.test.ts modules/india-post/provider.session.test.ts modules/india-post/event-mapper.test.ts modules/india-post/apply-tracking.test.ts modules/india-post/tracking-effects.test.ts modules/india-post/tracking-response.test.ts modules/india-post/webhook-allowlist.test.ts modules/ndr-rto/service.test.ts modules/ndr-rto/reconcile.test.ts modules/ndr-rto/db.test.ts lib/api/v1/ndr-rto.test.ts
```

**13 files, 86 passed, 0 failed.**

## Required cases

| # | Case | Result |
|---|---|---|
| 1 | Empty HTTP 200 `data` | `absent`; stamps `last_tracked_at` |
| 2 | Valid found article / no new events | ingest path; duplicates 23505 still in apply-tracking tests |
| 3 | HTTP 400 single | `lookup_rejected`; **not** treated as successful empty scan |
| 4 | Partial batch 400 | split; GOOD `found`, BAD `rejected` |
| 5 | Invalid AWB | unmatched article_number → `absent` on 200 |
| 6 | Authentication failure | login 401 → `PERMANENT_AUTH_ERROR`; enqueue `auth-cooldown` |
| 7 | Expired token | `ensureSession` re-logins |
| 8 | Credential mismatch (all 400) | all `lookup_rejected`; processor throws `TRACKING_LOOKUP_REJECTED` |
| 9 | Duplicate events | existing apply-tracking 23505 test |
| 10 | Out-of-order | existing planTrackingUpdate test |
| 11 | Item Delivered(Addressee) | DELIVERED |
| 12 | NDR/RTO / rts true | existing mapper tests |
| 13 | Tenant isolation | ndr-rto API + db tests |
| 14 | Shopify isolation | tracking-effects OFD does not fulfill |
| 15 | WhatsApp isolation | no new templates; empty events do not notify |

Isolation budget exhaustion: remaining AWBs rejected without infinite HTTP.

## TypeScript

`npx tsc --noEmit` — **PASS**

## Production build

`npm run build` — **PASS** (placeholder public Supabase env for prerender). `/dashboard/ndr-rto` and `/api/cron/jobs` present. Linux nixpacks not run.
