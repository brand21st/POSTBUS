# Migration inventory

Confirmed on disk, same eight files as Phase 3.0:

1. `supabase/migrations/20261017120000_affiliate_program.sql`
2. `20261017121000_affiliate_operations.sql`
3. `20261017122000_affiliate_webhook_leases.sql` — ALTER `razorpay_webhook_events` (additive columns)
4. `20261017123000_affiliate_reporting.sql`
5. `20261017124000_affiliate_reconciliation.sql`
6. `20261017125000_affiliate_partner_portal.sql`
7. `20261017130000_subscription_tax_policy.sql`
8. `20261017140000_subscription_tax_invoices.sql`

No additional 20261017+ affiliate files found after Phase 3.0.

Remote apply of this list is **not** authorized this phase.
