# PostBus Phase 2.6 affiliate integration

Status: verified locally. Production flags were not changed.

## Evidence

`subscription_apply_approved_tax` runs only from the affiliate sweep when `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` is true, or from the super-admin apply action under the same flag and the admin PIN.

The function selects the approved policy in force at `payments.paid_at`, or `created_at` when paid time is empty. It inserts `affiliate_tax_evidence` with the approver as actor. A second call for the same refund level returns `ALREADY_RECORDED`. A manual tax row with a different amount returns `CONFLICT` and does not insert a breakdown.

`CONFLICT`, `REVIEW_REQUIRED`, and `UNSUPPORTED_TAX_TREATMENT` stop the sweep before `affiliate_accrue`. `MISSING_CONFIGURATION` leaves the existing path in place, so `affiliate_accrue` still returns `TAX_REVIEW` and the reconciliation report can show `MISSING_TAX_EVIDENCE`.

Eligible net remains captured paise minus recorded tax. The existing 20 percent formula, 30-day hold, and one-commission-per-payment constraint are unchanged. AI credit and cross-organization payments return `INELIGIBLE`.

A later approved policy does not change a breakdown already stored. Refund tax for a new refund level is inserted only when the recomputed original tax still matches that breakdown.

## Flags

| Flag | Default | Effect |
| --- | --- | --- |
| `POSTBUS_AFFILIATES_ENABLED` | off | Partner routes |
| `POSTBUS_AFFILIATE_ACCRUAL_ENABLED` | off | Sweep does no work unless the master flag is also on |
| `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` | off | Payout requests |
| `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` | off | Approved-policy evidence writes |
| `POSTBUS_BILLING_GST_INCLUSIVE_LABEL` | off | “Inclusive of applicable GST” on plan prices |

Tax automation does not turn accrual on. Accrual does not invent tax. The customer label does not change the charged amount.
