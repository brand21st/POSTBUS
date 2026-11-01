# PostBus Phase 2.8 staging readiness

Status: BLOCKED.

`scripts/affiliate-staging-gate.mts` was not bypassed. No approved staging project ref was supplied. No remote SQL was executed.

## Checklist for a later, separately approved staging project

- A Supabase project that is not production.
- Service credentials that are not the production keys.
- Razorpay test keys only.
- Synthetic organizations, affiliates, and payments.
- No India Post booking, customer notification, or payout.
- Apply the seven local files in the order in `POSTBUS_PHASE27_STAGING_PLAN.md`.
- Leave `POSTBUS_BILLING_TAX_INVOICE_ENABLED` unset.
- Leave affiliate accrual and payout flags unset.
- Leave Business prices unchanged until the commercial price is chosen.
- Re-run the invoice and affiliate Vitest files against that database.
- Multi-session numbering still needs two PostgreSQL sessions after the schema exists.

`ENVIRONMENT=staging` is not approval.
