# Migration inventory (exact files)

Order for a *future* approved apply. None applied this phase.

| File | Purpose | Risk |
| --- | --- | --- |
| `20261017120000_affiliate_program.sql` | Tables, RLS, grants, immutable trigger | Additive. Touches new affiliate_* only. |
| `20261017121000_affiliate_operations.sql` | Accrue, bind, summary, admin RPCs | Additive functions. |
| `20261017122000_affiliate_webhook_leases.sql` | ALTER `razorpay_webhook_events` add lease columns; `claim_razorpay_webhook` | LOW–MED: alters existing webhook table. Additive columns. Must not run on production without separate billing approval. |
| `20261017123000_affiliate_reporting.sql` | conversions view, partner_records, admin_overview | Additive. |
| `20261017124000_affiliate_reconciliation.sql` | REPLACE summary; read-only recon report | REPLACE function only. |
| `20261017125000_affiliate_partner_portal.sql` | ALTER affiliate_links landing/utm; link_stats; REPLACE partner_records | Additive columns + replace report. |
| `20261017130000_subscription_tax_policy.sql` | Tax policy tables | Additive billing. |
| `20261017140000_subscription_tax_invoices.sql` | Invoice tables/RPCs | Additive billing. |

No DROP/TRUNCATE of merchant shipping tables in these files.

Approval must name this list. Timestamp proximity is not approval.
