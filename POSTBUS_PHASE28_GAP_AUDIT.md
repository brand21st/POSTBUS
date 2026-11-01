# PostBus Phase 2.8 gap audit

Checked against the repository on 17 October 2026. Phase 2.7 documents remain the billing baseline.

| Area | State |
| --- | --- |
| Affiliate ledger, 20% accrual, tax evidence | COMPLETE locally. Flags stay off. |
| GST-inclusive calculation and approved-policy gate | COMPLETE locally. No default rate. |
| Payment receipt invoices | COMPLETE. Left in place. |
| Subscription tax-invoice issuance | PARTIAL. Flag remains off. Supplier GSTIN is empty. |
| Pricing catalog | COMPLETE as a read path. Business price decision is BLOCKED. |
| Pricing toggle interactivity | Was BROKEN in the dev browser at `127.0.0.1`. Fixed and verified locally. |
| Merchant tax-invoice list | Was PARTIAL. Search, filters, and pagination are now implemented locally. Browser session UNVERIFIED. |
| Super Admin invoice screen | Was PARTIAL. Search, counts, and audit list are now implemented locally. Browser session UNVERIFIED. |
| Multi-session numbering | BLOCKED. No local `psql` or Docker was available. |
| Hosted Supabase RLS | UNVERIFIED. |
| Staging | BLOCKED. Gate still fails closed. |
| Production deploy | NOT STARTED. |
