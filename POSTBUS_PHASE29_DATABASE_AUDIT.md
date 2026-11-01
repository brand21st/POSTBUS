# Database audit

Eight additive files after existing PostBus schema:

1. 20261017120000 program tables, RLS, grants  
2. 20261017121000 operations RPCs including accrue/summary  
3. 20261017122000 webhook leases on `razorpay_webhook_events`  
4. 20261017123000 conversions view, partner_records, admin_overview  
5. 20261017124000 summary replace + read-only reconciliation_report  
6. 20261017125000 landing/utm columns, link_stats, partner_records replace  
7. 20261017130000 tax policy  
8. 20261017140000 tax invoices  

Depends on `auth.users`, `organizations`, `organization_members`, `subscriptions`, `payments`, `platform_admins`, `razorpay_webhook_events`.

Immortality: `affiliate_immutable` trigger on commissions/ledger. PGlite rejects updates.

Privileged RPCs granted to service_role. `affiliate_create_organization(text)` granted authenticated with `auth.uid()` check.
