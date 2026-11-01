# PostBus affiliate Phase 2.5 gap audit

Compared the Phase 1 and Phase 2 documents with the code on 17 October 2026. No remote database was changed.

## Already present

- Partner registration, approval, opaque referral links, signed first-touch cookie, organization attribution, and self-referral checks.
- `affiliate_accrue` returns `TAX_REVIEW` and inserts no commission when `affiliate_tax_evidence` is missing.
- `affiliate_reconciliation_report` labels that case `MISSING_TAX_EVIDENCE` and does not write.
- Ledger idempotency, 30-day hold, refund reversals, and the three feature flags default off.
- Admin tax action already requires a platform admin, an action PIN, and a reason.

## Gap closed locally

- No function refused a tax row that claimed the entire captured amount was tax. `classifyTaxEvidence` in `modules/affiliates/tax-evidence.ts` now returns `CONFLICT`, and `runAffiliateSweep` skips accrual for `CONFLICT` and `INVALID`.
- The sweep still calls `affiliate_accrue` when evidence is merely missing, so SQL remains the source of `TAX_REVIEW`.
- `scripts/affiliate-staging-gate.mts` exits 1 unless an approved staging project ref is set and is not on the production denylist.

## Still open

- Platform subscription invoices in `modules/billing/subscriptions.ts` store `amount_paise` only. They have no GST component. Automatic tax insert is NOT STARTED because there is no authoritative breakup.
- Merchant shipment invoices in `modules/invoices` are a different domain and are not a tax source.
- `20261017120000` through `20261017124000` are not on the production Supabase project. Confirmed earlier by `to_regclass('public.affiliate_settings')` returning null.
- Remote staging is UNVERIFIED. The safety gate was executed locally and returned `staging_not_approved`.
