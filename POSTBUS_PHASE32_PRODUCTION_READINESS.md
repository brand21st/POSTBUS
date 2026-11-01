# POSTBUS PHASE 3.2 — PRODUCTION READINESS

**NOT READY.** Do not deploy.

## Gate matrix

| # | Gate | Result |
| --- | --- | --- |
| 1 | Local tests | COMPLETE (113/113 in 14 files) |
| 2 | Production build locally | COMPLETE (`build:verify` exit 0). `next start` hydration still UNVERIFIED |
| 3 | Staging migration | BLOCKED STAGING_NOT_APPROVED |
| 4 | Partner Portal E2E | BLOCKED |
| 5 | Hosted RLS | BLOCKED |
| 6 | Razorpay test-mode | BLOCKED |
| 7 | Referral attribution hosted | BLOCKED (local cookie tests only) |
| 8 | Commission accrual hosted | BLOCKED |
| 9 | Duplicate prevention hosted | BLOCKED (local unit only) |
| 10 | Hold release hosted | BLOCKED |
| 11 | Refund reversal hosted | BLOCKED (local unit only) |
| 12 | Ledger reconciliation hosted | BLOCKED |
| 13 | UI/UX browser on production bundle | UNVERIFIED |
| 14 | Mobile | UNVERIFIED |
| 15 | Financial authorization hosted | BLOCKED |
| 16 | Performance at 100/1k/10k affiliates | NOT STARTED |
| 17 | Staging recovery plan | PREPARED (docs only) |
| 18 | Business price decision | **BUSINESS_PRICING_DECISION_REQUIRED** |
| 19 | GST/invoice approvals for enablement | Invoice issuance stays OFF |
| 20 | Production rollout plan approved | NO |
| 21 | Production migration authorization | NO |

Successful local tests do **not** authorize production migration or Coolify deploy.
