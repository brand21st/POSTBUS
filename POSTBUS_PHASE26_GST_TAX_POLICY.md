# PostBus Phase 2.6 tax policy

Status: implemented locally. Not applied to staging or production.

## Rule

Configured subscription prices are the customer payable amount. A policy with `prices_include_tax = false` is rejected. The engine extracts tax from the gross amount. It does not add GST on top.

## Stored policy

`subscription_tax_policies` in `supabase/migrations/20261017130000_subscription_tax_policy.sql`.

A row is `DRAFT`, `APPROVED`, or `RETIRED`. Only a platform admin can propose, approve, or retire, and the admin API also requires the action PIN. A draft cannot be selected by `subscription_apply_approved_tax`. Approval does not change the rate, place of supply, or effective time. After approval, those fields cannot be updated. Retiring a policy does not rewrite breakdowns already stored.

There is no default rate. `1800` basis points appears only in test fixtures.

## Resolver

`resolveApplicableSubscriptionTax` in `modules/billing/inclusive-tax.ts` returns:

- `APPROVED` when one approved inclusive policy is in force and the split reconciles
- `MISSING_CONFIGURATION` when no approved policy is in force
- `UNSUPPORTED_TAX_TREATMENT` for a non-INR charge or a policy that is not tax-inclusive
- `REVIEW_REQUIRED` when the rate, place of supply, or split is not usable
- `CONFLICT` when two approved policies tie on version and effective time

Place of supply is whatever the approved policy records: `INTRA` splits tax into CGST and SGST, `INTER` records IGST. The code does not infer this from a customer address. A tax advisor still has to confirm that one platform-wide treatment is valid.

## Still required from a tax advisor

The rate, the supplier GSTIN, the service classification, invoice numbering, and whether intra-state and inter-state customers need different policies. None of those legal identifiers were invented.
