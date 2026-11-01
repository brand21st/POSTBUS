# Razorpay test-mode plan

Do not use `rzp_live_`. Script `scripts/phase29-razorpay-test-mode-plan.mts` exits 1.

Reuse `modules/billing/webhooks.ts` `processRazorpayEvent`. Affiliate accrue is a later sweep, not a second verifier.

Local webhook unit tests passed in the 112-file run.

Remote test-mode charges: NOT AUTHORIZED this phase.
