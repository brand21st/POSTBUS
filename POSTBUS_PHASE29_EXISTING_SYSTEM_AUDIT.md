# Phase 2.9 existing system audit

Date: 17 Oct 2026. Claims below were re-checked against the tree, tests, and browser — not copied from Phase 2.8 reports.

| Module | Status | Evidence |
| --- | --- | --- |
| Affiliate tables/functions | IMPLEMENTED locally | `supabase/migrations/20261017120000`–`25000`. PGlite `modules/affiliates/ledger.pg.test.ts` 17 Oct 2026. |
| Affiliate tables on connected Supabase | BLOCKED | Production `hgacoeoovjxkzfbesmvl`. PGRST205. No remote apply. |
| Partner portal UI | IMPLEMENTED locally | Routes under `app/partner/*`, shell `components/affiliates/partner-shell.tsx`. |
| Partner portal vs live DB | PARTIALLY IMPLEMENTED | Login works. `/me` returns missing-schema. Metrics UNVERIFIED on hosted DB. |
| Partner APIs | IMPLEMENTED locally | `modules/affiliates/api.ts`. Vitest API security passed. |
| Commission ledger | VERIFIED LOCALLY | PGlite: once-only accrue, hold, refund, RLS. |
| Tax evidence | VERIFIED LOCALLY | `classifyTaxEvidence` never invents 18%. Accrue returns TAX_REVIEW without evidence. |
| GST-inclusive prices | VERIFIED LOCALLY | `modules/billing/inclusive-tax.test.ts`. Browser monthly Business ₹3,500.00. |
| Invoice issuance | IMPLEMENTED, flag off | `POSTBUS_BILLING_TAX_INVOICE_ENABLED` must be exact `true`. Unit test expects false. |
| Razorpay billing | VERIFIED LOCALLY | `modules/billing/webhooks.test.ts` in the 112-test run. Live charges NOT executed. |
| Staging gate | VERIFIED LOCALLY | `npx tsx scripts/affiliate-staging-gate.mts` → `{ok:false,reason:staging_not_approved}` exit 1. |
| Hydration / yearly toggle | VERIFIED LOCALLY (dev) | 127.0.0.1 `/pricing` Yearly pressed; Starter ₹4,790.40 /year. Production `next build` UNVERIFIED (dev owns `.next`). |
| Disposable PostgreSQL concurrency | BLOCKED | No docker, no psql on this machine. |
| Hosted RLS | UNVERIFIED | Plan script only. |
| Production affiliate flags | UNVERIFIED remotely | Local `.env.development.local` has `POSTBUS_AFFILIATES_ENABLED=true` for UI. Production flags were not changed. |
| Business seed vs catalog | BLOCKED business decision | Live UI ₹3,500. Seed still 550000 paise. Neither changed. |
