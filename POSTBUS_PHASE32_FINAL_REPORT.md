# POSTBUS PHASE 3.2 — FINAL ENGINEERING REPORT

**STAGING_NOT_APPROVED**

No remote writes. No production migrations. No deploy. No live Razorpay. No payouts. No tax invoices. Production project `hgacoeoovjxkzfbesmvl` was not used as a test-write target.

---

## 1. EXECUTIVE SUMMARY

Phase 3.2 completed **safe local verification** and **staging preparation**. Isolated production build succeeded (`npm run build:verify` exit 0 into `.next-verify/`). Typecheck exit 0 after a one-line tracking notice type fix. Affiliate/partner stack remains **IMPLEMENTED LOCALLY** and **VERIFIED LOCALLY** (unit + PGlite). Hosted Partner Dashboard metrics remain **BLOCKED** because `.env.local` still points at production, which lacks affiliate tables. Missing production tables were **not** created.

## 2. STAGING PROJECT STATUS

**BLOCKED.** No isolated project reference supplied. None invented.

## 3. ENVIRONMENT ISOLATION

**PARTIAL.** `npm run dev:staging` fail-closed without `.env.staging.local` (exit 1). Ordinary `next dev` still uses production `.env.local` (unchanged on purpose). `.env.staging.example` gitignored-secrets pattern intact.

## 4. DATABASE TARGET VERIFICATION

Effective Next env: production `hgacoeoovjxkzfbesmvl`. Staging apply target: **none**. Production exclusion for writes: **held**.

## 5. MIGRATION INVENTORY

**COMPLETE** locally. Eight files, same order as Phase 3.1. No ninth migration added to an apply list.

## 6. MIGRATION EXECUTION

Remote: **NOT STARTED** / **STAGING_NOT_APPROVED**. Local PGlite: **VERIFIED LOCALLY** via ledger/tax tests.

## 7. DATABASE SCHEMA

Hosted production: affiliate objects **absent** (expected). Staging hosted: **N/A**.

## 8. HOSTED SUPABASE RLS

**NOT STARTED.** PGlite ≠ hosted RLS.

## 9. PARTNER PORTAL UI/UX

**IMPLEMENTED LOCALLY.** Routes compiled in production build (`/partner/*` dynamic). Hosted data **BLOCKED**. Browser QA of `next start` **UNVERIFIED**.

## 10. PARTNER BACKEND APIs

**IMPLEMENTED LOCALLY.** `/api/partner/[...slugs]`, `/api/partner/register`, `/api/partner/qr`, `/api/affiliate-referral` present in the verify build. Hosted authz matrix **UNVERIFIED**.

## 11. PARTNER AUTHENTICATION

**PARTIAL.** Uses existing Supabase Auth. Production login can succeed; approved-partner data layer missing on production DB.

## 12. REFERRAL LINKS

**IMPLEMENTED LOCALLY** (opaque 24-char codes, campaign allowlist, copy/share/QR). Hosted click analytics **BLOCKED**.

## 13. CAMPAIGN TRACKING

**IMPLEMENTED LOCALLY.** Staging E2E **NOT STARTED**.

## 14. MERCHANT ATTRIBUTION

**VERIFIED LOCALLY** (signed cookie, first-touch, tamper reject). Hosted signup path **UNVERIFIED**.

## 15. PARTNER DASHBOARD ANALYTICS

**BLOCKED** against intended schema on the current effective DB. Distinct error: missing tables, not an empty ledger.

## 16. RAZORPAY TEST MODE

**UNVERIFIED.** No test-mode approval. No live calls.

## 17. GST-INCLUSIVE BILLING

**VERIFIED LOCALLY** (inclusive price = payable; evidence classifier). Hosted **UNVERIFIED**. Rate not assumed 18%.

## 18. TAX EVIDENCE

**VERIFIED LOCALLY** classifier. Hosted insert/apply **NOT STARTED**. Invoice issuance flag **OFF**.

## 19. RECURRING COMMISSION

**VERIFIED LOCALLY** (20% net, idempotency helpers). Hosted accrual **NOT STARTED**. Accrual flag remains off in staging example.

## 20. FINANCIAL LEDGER

Existing ledger only. Local PGlite **VERIFIED LOCALLY**. Hosted **UNVERIFIED**.

## 21. COMMISSION HOLD

**VERIFIED LOCALLY** in policy/ledger tests. Hosted clock **NOT STARTED**.

## 22. REFUNDS AND REVERSALS

**VERIFIED LOCALLY** integer-paise reversal. Hosted refund webhooks **NOT STARTED**.

## 23. MERCHANT INVOICES

Preview/PDF **IMPLEMENTED LOCALLY**. `POSTBUS_BILLING_TAX_INVOICE_ENABLED` **OFF**. No GSTIN invented.

## 24. SUPER ADMIN

Admin affiliate routes compile (`/admin/affiliates`, `/admin/tax`, `/admin/invoices`). Hosted approval E2E **UNVERIFIED**.

## 25. DATABASE CONCURRENCY

**BLOCKED** (no independent PostgreSQL sessions).

## 26. API SECURITY

**VERIFIED LOCALLY** (origin match, session identity, landing allowlist). Hosted RLS **UNVERIFIED**.

## 27. PRODUCTION BUILD

**VERIFIED LOCALLY:** `npm run build:verify` **exit 0** (~309s). Next.js 16.3.8, 96 static pages generated, partner and billing routes in the route table. **Not deployed.** `next start` hydration **UNVERIFIED**.

Next.js updated `tsconfig.json` include for `.next-verify/types`.

## 28. UI/UX BROWSER TESTS

Dev-server yearly toggle: prior phase **VERIFIED LOCALLY**. Production-bundle click-through: **UNVERIFIED**.

## 29. MOBILE RESPONSIVENESS

**UNVERIFIED** this phase.

## 30. PERFORMANCE

**NOT STARTED** (no 100 / 1,000 / 10,000 affiliate load on staging or production).

## 31. FEATURE FLAGS

Defaults remain fail-closed except local `.env.development.local` `POSTBUS_AFFILIATES_ENABLED=true` for UI. Payouts **OFF**. Tax invoice issuance **OFF**. Production flags **not changed**.

## 32. AUTOMATED TEST RESULTS

17 Oct 2026:

```
npx tsx scripts/dev-staging.mts
→ STOP: missing .env.staging.local; exit 1

npx tsx scripts/affiliate-staging-apply.mts
→ {"ok":false,"reason":"staging_not_approved"} STAGING_NOT_APPROVED exit 1

npx tsc --noEmit
→ first: TS2322 tracking-effects notices
→ after fix: TSC:0

npx vitest run (14 files: affiliates, referral route, staging-isolation, origin, proxy-matcher, inclusive-tax, subscription-invoice, webhooks, prices)
→ Test Files  14 passed (14)
   Tests  113 passed (113)

npm run build:verify
→ exit 0 (~309s); distDir .next-verify; 96 pages generated; not deployed
```

Gate token name confirmed: `AFFILIATE_STAGING_WRITE_AUTHORIZATION` must equal `AFFILIATE_STAGING_WRITE_APPROVED`. Not set this phase.

## 33. FILES MODIFIED

- `modules/india-post/tracking-effects.ts` — notices typed as `WatiNotifyEvent` so `order_confirmation` / `processing` / `booked` compile without widening `TrackingWhatsAppEvent`.
- `tsconfig.json` — Next.js `build:verify` added `.next-verify` type includes.
- Phase 3.2 documentation set (`POSTBUS_PHASE32_*.md`).

`.env.local` **not** modified. No new SQL migrations. Staging scripts **not** rewritten.

## 34. NEW MIGRATIONS

**None.**

## 35. STAGING VERIFICATION STATUS

**STAGING_NOT_APPROVED**

Prepared: isolation, inventory, recovery notes, test-mode checklist.  
Executed remotely: **nothing**.

## 36. PRODUCTION READINESS

**NOT READY.** See `POSTBUS_PHASE32_PRODUCTION_READINESS.md`.

## 37. REMAINING BLOCKERS

1. No approved isolated Supabase project ≠ `hgacoeoovjxkzfbesmvl`.
2. No `.env.staging.local`.
3. `.env.local` production (correct until staging exists).
4. Affiliate schema absent on production (must stay until a later production authorization).
5. Hosted RLS, Razorpay test-mode, attribution E2E, concurrency Postgres.
6. `next start` hydration / mobile pass.
7. **BUSINESS_PRICING_DECISION_REQUIRED** (Business ₹3,500 catalog vs ₹5,500 seed; yearly ₹33,600). Prices not changed.

## 38. REQUIRED APPROVALS

A–I from the master prompt, including exact eight filenames, synthetic writes, `rzp_test_` scope, and the existing write token. Do not set the token merely to bypass the gate.

## 39. NEXT RECOMMENDED ACTION

Create an isolated Supabase project. Place credentials only in `.env.staging.local`. Boot with `npm run dev:staging`. Separately authorize `npm run staging:affiliate-apply` for the eight inventoried files only. Then run hosted RLS and Razorpay **test-mode** journeys.

**STOP:** no unauthorized remote write. **STOP:** no production deploy.
