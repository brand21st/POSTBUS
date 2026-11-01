# POSTBUS PHASE 3.2 — EXECUTIVE AUDIT

Date: 17 Oct 2026.

Classification: **STAGING_NOT_APPROVED**. Prepared documentation and local verification only. No remote writes.

## What is true

The Affiliate Partner Portal remains **IMPLEMENTED LOCALLY** (UI, APIs, eight SQL files, PGlite tests). Hosted partner metrics remain **BLOCKED** because `.env.local` still targets production project `hgacoeoovjxkzfbesmvl`, which does not contain the affiliate schema. Missing production tables were **not** treated as permission to create them.

## Authorization checkpoint (A–I)

| Item | Status |
| --- | --- |
| A. Isolated staging project ref | **MISSING** — none supplied, none invented |
| B. Confirmation it is not production | **MISSING** |
| C. Verified staging database identity | **MISSING** — no `.env.staging.local` |
| D. Approved migration filenames | **NOT AUTHORIZED** — eight files inventoried only |
| E. Explicit migration write scope | **MISSING** |
| F. Synthetic Auth/DB write approval | **MISSING** |
| G. Staging credentials | **MISSING** |
| H. Razorpay test-mode scope | **MISSING** |
| I. `AFFILIATE_STAGING_WRITE_AUTHORIZATION=AFFILIATE_STAGING_WRITE_APPROVED` | **UNSET** (token name confirmed in `assertAffiliateStagingTarget`; not set to bypass the gate) |

Result: **STAGING_NOT_APPROVED**. Remote apply stopped before the first SQL statement.

## Local evidence this phase

- `npx vitest run` (14 files): 113 passed.
- `npx tsc --noEmit`: first run failed on `modules/india-post/tracking-effects.ts` (`order_confirmation` vs `TrackingWhatsAppEvent`). Minimal type fix applied. Second run: exit 0.
- `npx tsx scripts/dev-staging.mts`: fail-closed, missing `.env.staging.local`, exit 1.
- `npx tsx scripts/affiliate-staging-apply.mts`: `{"ok":false,"reason":"staging_not_approved"}` then `STAGING_NOT_APPROVED`, exit 1.
- `npm run build:verify`: isolated `next build` into `.next-verify/` (does not deploy). See `POSTBUS_PHASE32_PRODUCTION_BUILD.md`.

## Production safety

No production migrations, no production schema creation, no live Razorpay, no payouts, no tax invoices, no Coolify/production env overwrite, no deploy.
