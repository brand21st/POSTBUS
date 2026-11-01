# PostBus affiliate test plan

Run the existing suites before any staging flag is enabled. Do not create live Razorpay payouts and do not point tests at production.

## Commands

```text
npx vitest run modules/affiliates/policy.test.ts modules/affiliates/api.test.ts modules/affiliates/reconcile.test.ts modules/affiliates/ledger.pg.test.ts
```

`ledger.pg.test.ts` uses in-process PGlite and the affiliate SQL. It is the financial source of truth. The other files cover cookie math, API authorization, and the sweep's external boundaries.

Also run the existing billing webhook tests so the affiliate flag-off path is still compatible:

```text
npx vitest run modules/billing/webhooks.test.ts
```

## Mapping

| Scenario | Expected result | Where it is proved |
| --- | --- | --- |
| 1. Referred merchant pays once | One commission | `accrues and approves exactly once under repeated delivery` |
| 2. Renewal pays again | A second payment id can accrue; the first row stays unique | Unique `affiliate_commissions.payment_id`; a new payment is a new accrue call. Add a second-payment assertion if the current fixture uses one payment only. |
| 3. Duplicate webhook | No second commission or second accrual key | Same ledger test, plus `webhook leases reject concurrent claims` |
| 4. Failed payment | No commission | `authorized payments never accrue`; accrue returns `CAPTURE_REVIEW` without evidence |
| 5. Refund | Cumulative reversal, recoverable balance after a paid payout | `partial and full refunds are cumulative and create post-payout recovery` |
| 6. Cross-partner read | Other user's commission count is 0 and payout RPC is denied | `partner RLS exposes only own rows and denies financial writes` |
| 7. Two payout requests | Second amount is rejected; same idempotency key returns the same id | `reserves once, rejects overspending and duplicate-key mismatches` |
| 8. Existing merchant, new link | No extra attribution | `signup claim is first-touch` and `expired claim never attributes` |
| 9. Rate change | Stored `amount_paise` stays 200000 after a 5000 basis-point insert | `policy changes do not rewrite historical commissions` |
| 10. Suspension | Accrual still returns `RECONCILED`; payout raises | `suspension preserves accrual but blocks payout` |

## Additional cases already in the suite

- Half-up paise: 149900 at 2000 basis points equals 29980 (`policy.test.ts`).
- Cookie expiry and tamper rejection.
- Flags default off, and a disabled route does not call auth or the admin client.
- Cross-origin payout POST is forbidden.
- Payout body cannot inject another affiliate id.
- Admin PIN is required and is not stored in the RPC payload.
- AI credit billing cycle never calls Razorpay and never accrues.
- Provider errors are stored as `RETRY` without the provider body.
- Immutable update and delete fail even as the database owner.
- Non-admin `affiliate_admin_action` fails and writes no status audit row.
- Click dedupe does not store an IP address.
- Report projections hide organization and provider identifiers.
- A returned external payout restores funds once.

## Cases to add before accrual is enabled in staging

- Two distinct captured payments for the same attributed organization produce two commission rows and two accrual keys.
- A payment whose Razorpay amount differs from `payments.amount_paise` stays in `CAPTURE_REVIEW`.
- `affiliate_capture_time` returns null when the signed inbox has no captured payment entity, and the sweep does not accrue.
- Organization create with the master flag off still calls `create_organization_for_user` and inserts no attribution.

## RLS and admin permission checks

The PGlite test switches `request.jwt.claim.sub` and `set local role authenticated`. Staging QA repeats three checks with real Supabase roles:

- Partner A cannot read partner B commissions through the partner API.
- A merchant who is not a platform admin receives the existing admin API denial.
- Anon requests to affiliate tables return no rows.

## Out of scope for automated tests

- Real RazorpayX transfers.
- Production webhook replays.
- Click-volume load beyond the existing one-minute dedupe and rate limit.
