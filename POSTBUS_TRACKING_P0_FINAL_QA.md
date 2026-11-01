# POSTBUS Tracking P0 — Final QA

Date: 2026-10-10  
Worktree: `D:/POSTBUS-NDR-RTO-ISOLATED`  
Branch: `fix/tracking-ingestion-p0`

## Verified production baseline

Coolify `mw9larpomkyonxzy1rk3h6jm`: **running:healthy**, branch `support-center-release`, **git_commit_sha `865d295d8401aa55a3b20c6a1f937ceda94d846a`**, auto-deploy **off**.

## Local candidate

Uncommitted P0 ingest + **disabled-by-default canary gate** on top of `865d295`.

## Tests (rerun, not reused)

```
npx vitest run modules/india-post/tracking-p0-canary.test.ts modules/india-post/tracking-sync-run.test.ts modules/india-post/tracking-bulk.test.ts modules/india-post/tracking-ingest-page.test.ts modules/india-post/tracking-sync.test.ts modules/india-post/provider.session.test.ts modules/india-post/event-mapper.test.ts modules/india-post/apply-tracking.test.ts modules/india-post/tracking-effects.test.ts modules/india-post/tracking-response.test.ts modules/ndr-rto/service.test.ts modules/ndr-rto/reconcile.test.ts modules/ndr-rto/db.test.ts lib/api/v1/ndr-rto.test.ts
```

**14 files, 86 passed, 0 failed.**

`npx tsc --noEmit` PASS. `npm run build` PASS (placeholder public Supabase env). Node local v24; Coolify Node 22.

## Canary isolation

Empty `INDIA_POST_TRACKING_P0_CANARY_ORGANIZATION_ID` → **entire fleet uses legacy** `trackShipment({ isolateFailures: false })` (HTTP 400 skip chunk; missing article still stamps `last_tracked_at`).

Armed org + allowlist (max 5) → P0 outcomes, per-job isolate budget, Shopify/WhatsApp skipped unless `SIDE_EFFECTS=on`.

Manual `POST /api/v1/ndr-rto/:id/sync` on the canary org **refuses AWBs off the allowlist**. Scheduler will not enqueue the canary org until the allowlist is set.

## Deployment / live canary

**NOT EXECUTED — APPROVAL REQUIRED.**
