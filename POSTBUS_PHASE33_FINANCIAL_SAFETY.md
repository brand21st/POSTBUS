# PHASE 3.3 — FINANCIAL SAFETY

Preserve existing ledger. Accrual 20% of net excluding GST, 30-day hold, ₹1,000 minimum payout, tax evidence required (`TAX_REVIEW` if missing).

App flags intended for **initial** production (do not change Coolify until approved):

- `POSTBUS_AFFILIATES_ENABLED=false`
- `POSTBUS_AFFILIATE_ACCRUAL_ENABLED=false`
- `POSTBUS_AFFILIATE_PAYOUTS_ENABLED=false`
- `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED=false`
- `POSTBUS_BILLING_TAX_INVOICE_ENABLED=false`

Schema install does **not** accrue commissions. Accrual RPCs exist but app jobs must not call them until a later approval.

No payouts. No invented 18% GST. No synthetic production payments this phase.

Catalog prices (read-only): Starter 499 / 4790.40, Pro 1499 / 14390.40, Business **3500** / 33600. Seed 5500 unused. **BUSINESS_PRICING_DECISION_REQUIRED**.
