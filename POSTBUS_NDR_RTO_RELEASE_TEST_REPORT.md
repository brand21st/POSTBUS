# POSTBUS NDR/RTO — Isolated Test Report

Worktree: `D:/POSTBUS-NDR-RTO-ISOLATED`  
HEAD: `865d295d8401aa55a3b20c6a1f937ceda94d846a`  
Previous 105/105 result was **not** reused.

## Vitest (isolated candidate)

Command:

```
npx vitest run modules/india-post/event-mapper.test.ts modules/india-post/apply-tracking.test.ts modules/india-post/webhook.test.ts modules/india-post/webhook-process.test.ts modules/india-post/tracking-effects.test.ts modules/india-post/provider.session.test.ts modules/india-post/tracking-sync.test.ts modules/india-post/tracking-response.test.ts modules/india-post/webhook-allowlist.test.ts modules/india-post/session.test.ts modules/ndr-rto/service.test.ts modules/ndr-rto/reconcile.test.ts modules/ndr-rto/db.test.ts lib/api/v1/ndr-rto.test.ts
```

**Result: 14 files, 106 tests passed, 0 failed.** Duration ~2.2s. PGlite used for persistence tests. No production DB.

First isolated run failed (duplicate export in `apply-tracking.ts`); fixed; rerun green.

## Coverage vs required cases

| Case | Evidence | Result |
|---|---|---|
| Item Delivered(Addressee) → DELIVERED not NDR | `event-mapper.test.ts` TEST A | PASS |
| Explicit NDR reason | TEST C | PASS |
| Hold + Intimation Delivered not NDR | TEST B | PASS |
| Item Redirected unclassified | mapper test | PASS |
| Bagged / Bag Received / Dispatched / OFD | mapper test | PASS |
| rts true / false / missing | mapper test | PASS |
| Return completion vs customer delivery | TEST D/E; apply-tracking return delivery | PASS (fixture names; live CEPT UNVERIFIED) |
| Duplicate event NDR count | apply-tracking test | PASS |
| Out-of-order / older scan | planTrackingUpdate test | PASS |
| Missing timestamp skipped | ingest skip test | PASS |
| operational_status persistence | apply-tracking persist test | PASS |
| Dashboard unclassified count | ndr-rto API test `unclassifiedTracked: 1` | PASS |
| Tenant isolation | API sync other-tenant; db.test org filter | PASS |
| Tracking 400 empty | provider.session.test | PASS |
| CEPT timeout / session | provider.session.test | PASS |
| Partial bulk matching | matchingBulkTrackingArticle | PASS |
| FAILED poll eligibility | isTrackingPollStatus | PASS |
| Shopify isolation | tracking-effects.test (mocks) | PASS |
| WhatsApp isolation | tracking-effects + plan WhatsApp events | PASS |
| Dry-run reconcile / apply blocked | reconcile.test | PASS |

## TypeScript

`npx tsc --noEmit` — **PASS** (exit 0). Isolated tree has no untracked `scripts/*.mts`. Production `tsconfig.json` unchanged. Local Node **v24.7.0**; Coolify **Node 22**.

## Production build

1. Failed: Turbopack rejected worktree `node_modules` junction to `D:\POST BUS APP\node_modules`.
2. Failed: missing `NEXT_PUBLIC_SUPABASE_*` (worktree has no `.env`). Compile had already succeeded.
3. **PASS**: local `npm install`, placeholder public Supabase URL/anon for prerender only. `/dashboard/ndr-rto` and `/api/cron/jobs` present. Linux nixpacks not run.

## Shopify / WhatsApp

Mocks only. No live Shopify or WhatsApp calls.
