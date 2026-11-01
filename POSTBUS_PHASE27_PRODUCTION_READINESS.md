# PostBus Phase 2.7 production readiness

Status: not ready. Nothing from this phase was deployed.

| Area | State |
| --- | --- |
| Local invoice schema, numbering, preview PDF, and reconcile | Implemented locally |
| Issuance flag | Off unless `POSTBUS_BILLING_TAX_INVOICE_ENABLED=true` |
| Supplier GSTIN and legal identity | Empty. Issuance blocked. |
| GST rate | No default. Approved policy required. |
| Business price ₹3,500 versus seed ₹5,500 | Blocked. Neither value changed. |
| Staging migration | Not run |
| Production migration | Not run |
| Production flags and deploy | Untouched |

## Blockers

1. A tax advisor must approve the GST rate, place of supply, supplier legal name, supplier address, supplier GSTIN, invoice numbering series, financial-year rule, and cancellation treatment.
2. The Business commercial price must be confirmed before any catalog or seed edit.
3. Staging has no approved project ref.
4. The affiliate, tax-policy, and tax-invoice SQL files are not on production.
5. Credit-note and debit-note rules are not approved, so they were not built.
6. Interactive pricing-toggle hydration in the local dev browser is unverified. Yearly prices exist and differ from monthly prices.

## Required before any remote step

Separate explicit approval for staging SQL, then a later approval for production SQL, flags, and deploy. Checkout must keep working with invoice issuance off.
