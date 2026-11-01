# PostBus affiliate tax automation

Status: PARTIAL. Manual evidence remains the only writer. Automatic insert is NOT STARTED.

## What was verified

Subscription checkout records the amount the customer paid. It does not record a tax breakup. Assuming 18 percent GST would create `affiliate_tax_evidence` from a guess. That path is refused.

`hasAuthoritativeBreakdown` stays false in `modules/affiliates/reconcile.ts`. A captured payment with no tax row classifies as `MISSING`. `affiliate_accrue` then returns `TAX_REVIEW` and the reconciliation report can show `MISSING_TAX_EVIDENCE`.

## What an admin may record

The existing `tax` admin action inserts `affiliate_tax_evidence` with payment id, refunded paise, tax paise, refunded tax paise, reason, and actor. The affiliate admin screen now states that the amount must come from a platform subscription document, not a shipping invoice, and that 18 percent must not be assumed.

If the recorded tax is greater than or equal to the capture, or the refunded tax does not fit, the sweep classifies `CONFLICT` and does not call `affiliate_accrue`.

## Future billing

When a subscription invoice gains an explicit tax component that reconciles to `payments.amount_paise`, the resolver can set `hasAuthoritativeBreakdown` and a later change can insert evidence idempotently. Until that column exists, do not add a formula.

Eligible net for a stored row is `captured paise - tax paise`. Commission stays `(net * basis_points + 5000) / 10000`. A verified net of 2,000,000 paise at 2000 basis points is 400,000 paise. The captured total is not that net unless tax is recorded as zero by an admin.
