# POSTBUS PHASE 2.9 — FINAL ENGINEERING REPORT

## 1. EXECUTIVE SUMMARY

Local affiliate + billing + partner portal code is in the repository and the selected automated suite passed (112 tests, tsc 0). Staging is not approved. The app’s `.env` still points at production Supabase, which has no affiliate tables. Partner UI therefore cannot load metrics. No production migration, deploy, payout, invoice issue, or live Razorpay charge was performed.

## 2. CURRENT CODEBASE STATUS

IMPLEMENTED LOCALLY. Partner portal, APIs, eight SQL files, origin helper, staging gate.

## 3. PARTNER PORTAL UI/UX

IMPLEMENTED LOCALLY. VERIFIED LOCALLY only for login and missing-schema error. VERIFIED ON STAGING: no. DEPLOYED: no.

## 4. PARTNER BACKEND API

IMPLEMENTED LOCALLY. VERIFIED LOCALLY (Vitest). Hosted `/me` returns missing schema.

## 5. SUPABASE DATABASE

Local SQL COMPLETE. Hosted production MISSING affiliate_*. BLOCKED apply.

## 6. AUTHENTICATION

Same Supabase user. Login from 127.0.0.1 VERIFIED. Password min 10 on public register.

## 7. REFERRAL LINK TRACKING

Code COMPLETE. `affiliate-referral` never blocks `/`. Hosted click path UNVERIFIED (no tables).

## 8. MERCHANT ATTRIBUTION

PGlite first-touch, self-referral, unique org VERIFIED LOCALLY.

## 9. COMMISSION ENGINE

PGlite VERIFIED. Accrual flag required. Production accrual not enabled by this phase.

## 10. RECURRING COMMISSION VALIDATION

Renewal is a new payment row; second accrue once. PGlite VERIFIED.

## 11. GST-INCLUSIVE BILLING

Displayed = payable. Browser Business ₹3,500 monthly. No extra GST added in UI.

## 12. TAX EVIDENCE AUTOMATION

No default 18%. TAX_REVIEW until evidence. VERIFIED LOCALLY.

## 13. SUBSCRIPTION INVOICES

Preview/list code present. Issuance flag OFF. No invoices issued.

## 14. RAZORPAY VERIFICATION

Unit webhook tests PASS. Live/test remote charges NOT RUN.

## 15. FINANCIAL RECONCILIATION

Read-only SQL. No mutate. Local function present. Hosted UNVERIFIED.

## 16. DATABASE MIGRATIONS

Eight files. Dry-run PGlite PASS. Remote NOT APPLIED.

## 17. POSTGRESQL CONCURRENCY

BLOCKED (no docker/psql). Do not treat PGlite as multi-session Postgres.

## 18. ROW-LEVEL SECURITY

PGlite PASS. Hosted UNVERIFIED.

## 19. API SECURITY

Origin, rate limit, session identity, payouts flag. Vitest PASS.

## 20. NEXT.JS HYDRATION

Dev 127.0.0.1 yearly toggle VERIFIED. Production build UNVERIFIED.

## 21. MOBILE RESPONSIVENESS

Code present. Browser UNVERIFIED (schema blocks shell).

## 22. PERFORMANCE TESTING

NOT STARTED at 100–10k partners. Indexes exist on click events and new links index. No prod load test.

## 23. FEATURE FLAGS

All financial writes require exact string `true`. Defaults off except local affiliates UI flag. Production flags not changed.

| Flag | Default in code | This phase |
| --- | --- | --- |
| POSTBUS_AFFILIATES_ENABLED | off unless `true` | local env true for UI only |
| POSTBUS_AFFILIATE_ACCRUAL_ENABLED | off | unchanged |
| POSTBUS_AFFILIATE_PAYOUTS_ENABLED | off | unchanged |
| POSTBUS_BILLING_TAX_AUTOMATION_ENABLED | off | unchanged |
| POSTBUS_BILLING_GST_INCLUSIVE_LABEL | off | unchanged |
| POSTBUS_BILLING_TAX_INVOICE_ENABLED | off | unchanged |

## 24. AUTOMATED TEST RESULTS

`npx vitest run` 14 files, 112 passed, 17 Oct 2026 11:23. `npx tsc --noEmit` 0.

## 25. BROWSER TEST RESULTS

Pricing yearly PASS. Partner payouts missing-schema PASS as expected. Dashboard data FAIL/BLOCKED.

## 26. STAGING ENVIRONMENT STATUS

STAGING_NOT_APPROVED. Gate exit 1. Hosted RLS plan exit 1. Razorpay plan exit 1.

## 27. PRODUCTION READINESS

NOT READY. Gates 4–6, 11 hosted, 14, 17–18 open.

## 28. CRITICAL BLOCKERS

1. No authorized isolated staging project.  
2. Local env uses production Supabase.  
3. Affiliate schema absent on that project.  
4. No disposable PostgreSQL for concurrency.  
5. Business price dual values unresolved.  
6. Production next start hydration untested.

## 29. FILES CREATED OR MODIFIED

Created: Phase 2.9 markdown set, `scripts/phase29-hosted-rls-plan.mts`, `scripts/phase29-razorpay-test-mode-plan.mts`.

Modified: `modules/affiliates/tax-evidence.ts`, `scripts/affiliate-staging-gate.mts`, `modules/affiliates/policy.test.ts`.

No production env or SQL.

## 30. REQUIRED APPROVALS

Isolated project ref, non-production confirmation, migration apply permission, test credentials, write-scope token `AFFILIATE_STAGING_WRITE_APPROVED`.

## 31. NEXT RECOMMENDED ACTION

Supply an approved staging project that is not `hgacoeoovjxkzfbesmvl`. Re-run the gate. Only then apply migrations 20261017120000–25000 (and tax files if invoice preview is in scope) and repeat partner E2E on that database.

STOP: no remote writes executed.
