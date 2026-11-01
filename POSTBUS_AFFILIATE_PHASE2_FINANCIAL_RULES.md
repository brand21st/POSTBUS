# PostBus affiliate Phase 2 financial rules

## Eligible gross

The gross is the integer paise amount on the verified captured payment, matched to Razorpay and to `payments.amount_paise`. It is not the plan list price. A discounted, upgraded, downgraded, or prorated charge uses the amount that was actually captured.

## Eligible net

`net_paise = evidence.amount_paise - tax_evidence.tax_paise`

Tax comes only from `affiliate_tax_evidence`, written by a platform admin with a reason and actor. If that row is missing, or tax is not less than the captured amount, `affiliate_accrue` returns `TAX_REVIEW` and inserts nothing.

There is no default GST rate.

## Commission

Percentage: `(net_paise * basis_points + 5000) / 10000` using integer division. 5000 is the half-up adjustment for basis points out of 10000.

Fixed policy: `least(fixed_paise, net_paise)`.

The chosen `affiliate_policies` row is the most specific row effective at capture time: link, then partner, then platform default. It is copied onto `affiliate_commissions.policy_snapshot`.

Default platform policy remains 2000 basis points, which is 20 percent.

Example: net 1,499.00 rupees is 149900 paise. At 2000 basis points the commission is 29980 paise.

## Hold and release

`available_at` is capture time plus `affiliate_settings.hold_days` (default 30). Before that time the ledger has `ACCRUAL` only and available balance does not include it. A later accrue inserts one `APPROVAL` row with idempotency key `approval:<payment id>`.

## Refunds

Reversal paise is `(commission * refunded_net + original_net / 2) / original_net`. Only the increase since the last reversal is inserted, keyed by `refund:<payment id>:<refunded paise>`. A refund after payout increases `recoverable` and does not edit the paid ledger row.

## Exclusions

- No subscription id: `INELIGIBLE` (covers India Post and other non-subscription charges stored as payments)
- `billing_cycle = ai_credits`: `INELIGIBLE`
- Currency other than INR: `INELIGIBLE`
- Failed, authorized, or unsigned captures: no evidence row, so no accrual
- Trial with no captured payment: no commission

## One accrual

`affiliate_commissions.payment_id` is unique. Repeating accrue returns the existing row and does not insert a second accrual key.
