# POSTBUS PHASE 3.2 — GST-INCLUSIVE BILLING

Confirmed product rule: displayed subscription price **is** the payable amount. Do not add GST on top.

Engine preserved: `subscription_tax_policies`, breakdowns, `subscription_apply_approved_tax`, `affiliate_tax_evidence`, `classifyTaxEvidence`.

## Tests (local)

`classifyTaxEvidence` does not treat a captured total as tax. Missing evidence stays `MISSING`. Zero tax is only `VERIFIED` when an existing evidence row exists (not invented). `MANUAL_REVIEW_REQUIRED` when breakdown exists without a stored evidence row. GST rate is **not** assumed to be 18%.

## Flags

`POSTBUS_BILLING_TAX_INVOICE_ENABLED` remains **OFF**. Invoice numbering / GSTIN issuance **not** performed.

## Business price mismatch (unchanged)

Catalog Business monthly ₹3,500 vs seed ₹5,500; yearly ₹33,600. **BUSINESS_PRICING_DECISION_REQUIRED**. Checkout must follow authorized `plans` row. Prices not changed this phase.

## Hosted tax evidence

**UNVERIFIED ON STAGING.**
