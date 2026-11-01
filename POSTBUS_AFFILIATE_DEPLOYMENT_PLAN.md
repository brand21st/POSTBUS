# PostBus affiliate deployment plan

This plan does not authorize a production migration or a Coolify deploy. Those stay behind a separate approval after staging QA.

## Current state

- Production billing, auth, and India Post are unchanged on the release branch.
- Affiliate SQL and application code exist only as local, uncommitted work.
- Flags default off. Unset means disabled.
- The webhook route, organization service, signup routes, proxy, admin nav, and billing cron in the working tree contain affiliate branches. They must not be cherry-picked into an India Post release by accident.

## Environments

| Step | Database | Flags | Payouts |
| --- | --- | --- | --- |
| Local tests | PGlite inside Vitest | Forced by the test | None |
| Staging | Staging Supabase only | Off, then one at a time | Test UPI masks only, no real transfer |
| Production | Not in this plan | Off | Not created |

## Staging order

1. Copy the four SQL files onto the staging migration path and apply them in timestamp order.
2. Deploy the application build to staging with all three affiliate variables unset.
3. Smoke-test merchant registration, organization create, a signed Razorpay test webhook, and an India Post booking path that staging already uses. Expect no affiliate rows.
4. Set `POSTBUS_AFFILIATE_COOKIE_SECRET` and `POSTBUS_AFFILIATES_ENABLED=true`. Leave accrual and payouts unset.
5. Register a partner, approve with the admin PIN, open `/?ref=`, sign up a new merchant, and confirm one attribution.
6. Confirm an already onboarded merchant does not move to a second partner.
7. Set `POSTBUS_AFFILIATE_ACCRUAL_ENABLED=true` only after a tax-evidence procedure is written for staging payments. Use Razorpay test mode. Expect one commission for one captured test payment and no commission for a failed test payment.
8. Replay the same test webhook. Expect no second commission.
9. Refund the test payment. Expect a reversal, not an edited commission row.
10. Leave `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` off until steps 5 through 9 pass. Then request a payout at the minimum and reject it. Do not mark a real bank transfer `PAID`.

## Production gate, later approval only

All of the following must already be true:

- Staging steps 1 through 9 passed.
- `ledger.pg.test.ts`, API tests, reconcile tests, policy tests, and billing webhook tests passed.
- Cookie secret, admin PIN, and encryption key exist only in the secret store.
- The release commit contains the affiliate module alone, not unrelated dirty files.
- Rollback owner agrees that turning flags off stops new claims, new accruals, and new payout requests without deleting ledger rows.

Production apply of the four SQL files is still a separate explicit approval. Do not run it as part of writing these documents.

## Rollback

- Flags off stops new clicks, new claims, new accruals, and new payout requests.
- Existing `affiliate_*` rows stay. Do not drop the tables as a rollback.
- Organization create returns to `create_organization_for_user` as soon as the master flag is off.
- Webhook lease columns can remain. With the master flag off, the route uses the original unique-event duplicate path.
- Do not reverse a `PAID` payout by editing the row. Use the `RETURNED` action, which appends `PAYOUT_RETURN`.

## Forbidden during every test

- Production service-role scripts against live payments.
- Real partner bank or UPI transfers.
- Changes to plan prices, trial length, or Razorpay live keys.
- Edits to India Post booking, tracking, or shipment code inside the affiliate release.
