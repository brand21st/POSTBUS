# Harden billing: activate only on verified, captured payments

**Base:** `release/booking-safety-on-a2169cd-20261031` (production line, `c0be1e1`) · **Head:** `fix/billing-p0-hardening` (`7687dc8`)

Fixes the billing P0 audit findings on the line production runs. **Do not merge or deploy before the steps under "Before deploy".**

## What changes
- **Retry after a failed card (F-06):** failed attempts are stored in a new `payment_attempts` table instead of a second `payments` row. A customer who fails and then pays in the same Checkout is activated exactly once. Before, the order became "ambiguous" and the paid customer was never activated. Payment classification no longer errors when an order has more than one row.
- **Webhook retries (F-07):** events are claimed with a lease, so Razorpay's retry reprocesses a failed event. The billing cron asks Razorpay (read-only) about stale PENDING orders and activates captured ones through the same fulfillment RPC. It never activates authorized-only or unpaid orders.
- **Feature access after expiry (F-05):** one access decision (`modules/billing/access.ts`) drives booking, plan features, session, resume and the billing page. Paid features stop at the end of the trial or paid period. Merchants can still read their invoices, manifests, tracking-page settings and label templates.
- **Resume (F-08):** only clears a scheduled cancellation inside a covered paid period. It never sets ACTIVE.
- **Renewal:** paying before the paid period ends keeps the unused days.
- **Trial cutoff:** merchants who joined before 2026-11-01 00:00 IST get no trial.
- **Billing page:** labels come from server state ("Free Trial — X days remaining", "Payment Pending", "Payment Not Completed", "Payment Failed — Retry", "Subscription Expired — Upgrade Required"). A trial never shows as "Current plan".
- **Deploy safety:** the build commit appears in `/api/health` (`data.build`) and the `x-postbus-build` header. `scripts/ci/billing-guard.mjs` plus `.github/workflows/billing-guard.yml` block vulnerable billing code. The guard blocks `c0be1e1`, `8a52c36`, `a27c8e6` and `origin/main`.

## Database
- `supabase/migrations/20261101100000_billing_p0_hardening.sql`: additive and idempotent. It adds `payment_attempts`, webhook lease columns plus `claim_razorpay_webhook_event`, and reconciliation columns, and replaces `fulfill_captured_subscription_purchase` with the same signature. **Apply it before deploying the code.**
- `supabase/remediation/`: preview, apply and revert scripts for the unpaid ACTIVE row and the Oct 27–31 trial cohort. **Not run.** Each needs owner approval.
- `BILLING_EXPIRE_ONE_TIME_ACTIVE` stays unset. Turning it on rewrites existing rows.

## Tests
- Local: 58 files, 310 tests pass (billing, Razorpay, add-ons, AI credits, `app/api`, `lib/api`, guard). That includes PGlite tests that run the real migration, RPC, remediation and revert SQL. The previous RPC reproduces the ambiguity bug on the same data.
- `tsc --noEmit` and ESLint pass on the changed files.
- **`next build` was not run locally** (the build machine's disk was full). It needs to pass in CI.
- Not tested: a Supabase staging migration, Razorpay test-mode payments, and a browser check of the billing page.

## Before deploy
1. Apply the migration on staging. Run Razorpay test mode: dismiss; fail → retry → capture; close the browser after paying; duplicate webhook.
2. Run `node scripts/ci/billing-guard.mjs --ref <sha>`. Deploy with the `SOURCE_COMMIT` build arg and confirm `/api/health` → `data.build.commit`.
3. Run `scripts/billing/razorpay-pending-audit.mts --read-only` before the first reconciliation run.

Details: `POSTBUS_BILLING_P0_AUDIT_REPORT.md` and `POSTBUS_BILLING_P0_FIX_REPORT.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
