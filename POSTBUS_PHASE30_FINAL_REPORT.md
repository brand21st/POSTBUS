# POSTBUS PHASE 3.0 — FINAL ENGINEERING REPORT

## 1. EXECUTIVE SUMMARY

Local affiliate and billing code remains in the tree. Automated tests were re-run: **14 files / 112 tests passed** (affiliate+billing+security set) plus **isolation 4/4**, **tsc 0**. Staging is **not approved**. Local `.env.local` still targets production Supabase `hgacoeoovjxkzfbesmvl`. Partner dashboard still cannot load metrics. **No remote writes. No production deploy. No live Razorpay. No payouts. No tax invoices issued.**

## 2. CURRENT REPOSITORY STATUS

IMPLEMENTED LOCALLY. Not hosted-complete.

## 3. ENVIRONMENT ISOLATION

PARTIAL. Audit script and `assertNonProductionMutationTarget` added. `.env.local` still production — left unchanged (no staging target to switch to).

## 4. STAGING PROJECT STATUS

BLOCKED. **STAGING_NOT_APPROVED.**

## 5. DATABASE MIGRATION INVENTORY

COMPLETE as documentation. Eight files listed. `20261017125000_affiliate_partner_portal.sql` confirmed on disk.

## 6. MIGRATION VALIDATION

VERIFIED LOCALLY (PGlite). VERIFIED ON STAGING: no.

## 7. POSTGRESQL CONCURRENCY

BLOCKED — no docker/psql.

## 8. PARTNER PORTAL UI/UX

IMPLEMENTED LOCALLY. Hosted metrics BLOCKED.

## 9. PARTNER BACKEND APIS

IMPLEMENTED LOCALLY. Hosted `/me` missing schema.

## 10. PARTNER AUTHENTICATION

Login previously verified; this phase confirmed dashboard error path. Register min password 10.

## 11. REFERRAL LINK TRACKING

Code COMPLETE. Hosted UNVERIFIED.

## 12. MERCHANT ATTRIBUTION

PGlite VERIFIED LOCALLY.

## 13. DASHBOARD ANALYTICS

BLOCKED on connected DB.

## 14–16. COMMISSION / HOLD / REFUND

PGlite VERIFIED LOCALLY. Staging UNVERIFIED.

## 17–19. GST / TAX / INVOICES

Local tests PASS. Issuance OFF. No 18% invention.

## 20. RAZORPAY TEST-MODE VERIFICATION

Local webhook tests PASS. Remote NOT STARTED.

## 21. FINANCIAL RECONCILIATION

Read-only SQL present. Hosted UNVERIFIED.

## 22. HOSTED SUPABASE RLS

UNVERIFIED.

## 23. API SECURITY

Vitest PASS. Origin + session identity.

## 24. NEXT.JS PRODUCTION BUILD

UNVERIFIED. Dev server still running on port 3000 / `.next`. Not killed to avoid interrupting local shipping UI. Do not treat `next dev` as `next build`.

## 25. BROWSER E2E

Partner dashboard missing-schema VERIFIED. Full partner E2E BLOCKED.

## 26. MOBILE UI/UX

UNVERIFIED.

## 27. PERFORMANCE

NOT STARTED / BLOCKED vs production DB.

## 28. FEATURE FLAGS

Production files: affiliates/accrual/payouts/invoice unset (treated as off except local `POSTBUS_AFFILIATES_ENABLED=true` in `.env.development.local` for UI). Accrual/payouts/invoice not set true. Production remote flags not changed.

## 29. AUTOMATED TEST RESULTS

17 Oct 2026:

- `npx tsx scripts/affiliate-staging-gate.mts` → staging_not_approved, exit 1  
- `npx vitest run` 14 files, 112 passed (same set as Phase 2.9 plus current code)  
- `npx vitest run lib/env/staging-isolation.test.ts` 4 passed  
- Combined: **15 files, 116 tests**, not 112 alone  
- `npx tsc --noEmit` exit 0  

## 30. FILES CREATED OR MODIFIED

Created: Phase 3.0 markdown set, `scripts/phase30-env-targets.mts`.

Modified: `lib/env/staging-isolation.ts`, `lib/env/staging-isolation.test.ts`, `.env.example`, `.env.staging.example`.

`.env.local` not modified.

## 31. MIGRATIONS CREATED OR MODIFIED

None this phase. Inventory only.

## 32. STAGING EXECUTION STATUS

**STAGING_NOT_APPROVED.** Gate not forced. Write token not set.

## 33. PRODUCTION READINESS

NOT READY.

## 34. REMAINING BLOCKERS

1. No approved isolated project.  
2. Local env uses production.  
3. Affiliate schema absent on production (correct).  
4. No disposable Postgres.  
5. Production build unverified.  
6. Business price dual values.  
7. Hosted RLS and Razorpay test-mode.

## 35. REQUIRED APPROVALS

Exact staging project ref ≠ hgacoeoovjxkzfbesmvl; exact migration file list; write token `AFFILIATE_STAGING_WRITE_APPROVED`; test Razorpay; permission to apply.

## 36. RECOMMENDED NEXT ACTION

Create or name a non-production Supabase project. Point a **copy** of env (not production Coolify) at it. Re-run the gate. Only then apply the eight files in inventory order.

STOP: no unauthorized remote write executed.
