# PostBus affiliate Phase 2.5 audit

## Tax source

`payments.amount_paise` is the captured Razorpay total. Billing webhook and subscription activation do not persist a tax amount. The subscription invoice insert writes `amount`, `amount_paise`, currency, period, and Razorpay ids. It does not write GST.

Razorpay client code in `modules/razorpay` has no tax or GST field mapping.

Shipment `invoices.tax_amount` belongs to merchant orders. It is not evidence for a PostBus subscription.

## Resolver

`classifyTaxEvidence` outcomes:

- `MISSING` when no tax row exists and no authoritative breakup exists. This is the current production-shaped case.
- `MANUAL_REVIEW_REQUIRED` only if a future source sets `hasAuthoritativeBreakdown`. The sweep passes `false`.
- `VERIFIED` when an existing row has tax strictly below the captured amount and refunded tax fits inside both the tax and the refund.
- `CONFLICT` when those bounds fail, including tax equal to the full capture.
- `INVALID` when the captured amount is not positive or the refund exceeds the capture.

Zero tax is `VERIFIED` only when an admin row already says the tax is zero. The sweep does not insert that row.

## Commission recovery

Attribution is not deleted while tax is missing. After a valid admin tax insert, `affiliate_admin_action` sets the processing queue due, and `affiliate_accrue` inserts one commission because `payment_id` is unique.

## Flags

- `POSTBUS_AFFILIATES_ENABLED`
- `POSTBUS_AFFILIATE_ACCRUAL_ENABLED`, also requires the master flag
- `POSTBUS_AFFILIATE_PAYOUTS_ENABLED`, also requires the master flag

There is no separate registration, dashboard, or release flag. Unset means off. This session did not change any environment.
