# POSTBUS PHASE 3.2 — COMMISSION VERIFICATION

Business rules unchanged:

- 20% recurring on eligible **net** subscription revenue excluding GST
- 30-day first-touch attribution
- 30-day hold
- ₹1,000 minimum payout (payouts flag OFF)
- One eligible payment → one original commission (idempotent)

## Local

Integer-paise commission, refund reversal, capture eligibility, flags default off: **VERIFIED LOCALLY** (`modules/affiliates/policy.test.ts` and ledger PGlite tests in the 113-test run).

## Staging E2E (initial, renewal, annual, duplicate webhook, refund, hold clock)

**NOT STARTED.** Would require synthetic payments and approved tax evidence — not invented, not applied.

Payouts: remain disabled. No RazorpayX.
