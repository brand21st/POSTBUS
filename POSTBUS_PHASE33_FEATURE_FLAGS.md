# PHASE 3.3 — FEATURE FLAGS

| Flag | Code | Initial production intent | Coolify this phase |
| --- | --- | --- | --- |
| `POSTBUS_AFFILIATES_ENABLED` | exact `"true"` | false | **unchanged** |
| `POSTBUS_AFFILIATE_ACCRUAL_ENABLED` | requires affiliates true | false | unchanged |
| `POSTBUS_AFFILIATE_PAYOUTS_ENABLED` | requires affiliates true | false | unchanged |
| `POSTBUS_BILLING_TAX_AUTOMATION_ENABLED` | billing module | false | unchanged |
| `POSTBUS_BILLING_GST_INCLUSIVE_LABEL` | display | do not assume | unchanged |
| `POSTBUS_BILLING_TAX_INVOICE_ENABLED` | issuance | false | unchanged |

Local `.env.development.local` may set affiliates true for UI only. That is not production.

Partial-state blocker: affiliates true + missing schema → partner AUTH_UNAVAILABLE and webhook 503 on duplicate events.
